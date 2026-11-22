import { dateIndex, dateLabel, dateParts, moonPhase, mod, phaseNames, weekday, type Calendar } from './calendar'
import { dayOf, hasOccurrence, minutes, occurrences, type EventData } from './events'
import type { Campaign } from './storage'
import { yearStart } from './confidence'
import { closingDay, dueMonth, validHoldings, type TurnMonth } from './domain'

export function migrate(campaign: Campaign, next: Calendar) {
  const old = campaign.calendar
  const changes: string[] = []
  const affected: { before: number; after: number }[] = []
  const errors: string[] = []
  function changeDate(before: number, after: number, label: string) {
    const previous = `${old.weekdays[weekday(old, before)]}, ${dateLabel(old, before)}`
    const proposed = `${next.weekdays[weekday(next, after)]}, ${dateLabel(next, after)}`
    if (before !== after || previous !== proposed) {
      changes.push(`${label}: ${previous} → ${proposed}`)
      affected.push({ before, after })
    }
  }
  function day(value: number, label: string) {
    const date = dateParts(old, value)
    const period = next.periods.find(p => p.id === date.period)
    if (!period) {
      errors.push(`${label}: ${dateLabel(old, value)} belongs to a removed period.`)
      return value
    }
    const mapped = dateIndex(next, { ...date, day: Math.min(date.day, period.days) })
    changeDate(value, mapped, label)
    return mapped
  }
  const time = (value: number, label: string) => day(dayOf(value), label) * minutes + mod(value, minutes)
  const moveEvent = <T extends EventData>(event: T): T => {
    const start = time(event.start, `${event.title} start`)
    const end = event.allDay ? time(event.end - minutes, `${event.title} last day`) + minutes : time(event.end, `${event.title} end`)
    if (end <= start) errors.push(`${event.title} would end at or before its start.`)
    return { ...event, start, end }
  }
  const current = day(campaign.current, 'Campaign clock')
  const moons = next.moons.map(moon => ({ ...moon, anchor: day(moon.anchor, `${moon.name} anchor`) }))
  const events = campaign.events.map(event => {
    const exceptions: typeof event.exceptions = {}
    for (const [key, value] of Object.entries(event.exceptions)) {
      const original = time(Number(key), `${event.title} recurrence exception`)
      if (Object.hasOwn(exceptions, original)) errors.push(`${event.title} has overlapping recurrence exceptions.`)
      exceptions[original] = value && moveEvent(value)
    }
    const rule = event.rule && { ...event.rule, until: event.rule.until === undefined ? undefined : day(event.rule.until, `${event.title} repeat end`) }
    if (rule?.weekdays.some(value => value >= next.weekdays.length)) errors.push(`${event.title} uses a weekday that was removed.`)
    const moved = { ...moveEvent(event), rule, exceptions, cutoff: event.cutoff === undefined ? undefined : time(event.cutoff, `${event.title} repeat cutoff`) }
    if (!errors.length && Object.keys(exceptions).some(key => !hasOccurrence(next, moved, Number(key)))) {
      errors.push(`${event.title} has an edited or canceled occurrence that no longer matches the recurrence rule.`)
    }
    return moved
  })
  for (const moon of moons) {
    const previous = old.moons.find(item => item.name === moon.name)
    const after = phaseNames[moonPhase(moon, current)]
    changes.push(`${moon.name} at the campaign date: ${previous ? phaseNames[moonPhase(previous, campaign.current)] + ' → ' : ''}${after}`)
  }
  const holdings = campaign.holdings?.map(holding => {
    function compareMonth(label: string, before: TurnMonth, after = before) {
      const start = closingDay(old, before)
      try {
        const end = closingDay(next, after)
        if (start !== end || dateLabel(old, start) !== dateLabel(next, end) || old.weekdays[weekday(old, start)] !== next.weekdays[weekday(next, end)]) {
          changes.push(`${holding.name} ${label}: ${dateLabel(old, start)} → ${dateLabel(next, end)}`)
          affected.push({ before: start, after: end })
        }
      } catch {
        errors.push(`${holding.name} ${label} uses a removed month or a period changed to a festival.`)
      }
    }
    for (const turn of holding.turns) compareMonth('recorded turn', turn.month)
    for (const draft of holding.replay) compareMonth('reopened turn', draft.month)
    for (const effect of holding.confidence?.effects ?? []) compareMonth(effect.title, effect.target)
    if (validHoldings(next, [holding])) {
      compareMonth('next turn', dueMonth(old, holding), dueMonth(next, holding))
    } else {
      errors.push(`${holding.name} would have an invalid first month, or reordered domain turns.`)
    }
    const state = holding.confidence
    if (!state) return holding
    const annualDate = (value: number, year: number, label: string) => {
      const proposed = yearStart(next, year)
      changeDate(value, proposed, label)
      return proposed
    }
    const confidence = {
      ...state,
      start: state.start === undefined ? undefined : day(state.start, `${holding.name} start`),
      reviews: state.reviews.map(review => ({ ...review, day: annualDate(review.day, review.year, `${holding.name} annual review`) })),
      checks: state.checks.map(check => {
        const label = `${holding.name} confidence check`
        return { ...check, day: check.trigger === 'annual'
          ? annualDate(check.day, dateParts(old, check.day).year, label)
          : day(check.day, label) }
      }),
      events: state.events.map(event => ({ ...event, day: day(event.day, event.title),
        resolvedDay: event.resolvedDay === undefined ? undefined : day(event.resolvedDay, `${event.title} resolution`) })),
    }
    return { ...holding, confidence }
  })
  if (!errors.length && events.some(event => event.rule)) {
    const before = occurrences(old, campaign.events.filter(event => event.rule), campaign.current, campaign.current + 30)
    const after = occurrences(next, events.filter(event => event.rule), current, current + 30)
    changes.push('Recurring dates in the next 30 in-world days:')
    for (const [label, results, calendar] of [['Before', before, old], ['After', after, next]] as const) {
      const summary = results.slice(0, 10).map(event => `${event.title} on ${dateLabel(calendar, dayOf(event.start))}`).join('; ')
      changes.push(`${label}: ${summary || 'No occurrences'}${results.length > 10 ? ` (+${results.length - 10} more)` : ''}`)
    }
  }
  return { campaign: { ...campaign, current, calendar: { ...next, moons }, events, ...(holdings ? { holdings } : {}) }, changes, errors, affected }
}
