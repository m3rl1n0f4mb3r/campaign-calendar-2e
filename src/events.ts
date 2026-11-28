import { dateIndex, dateParts, mod, movePeriod, weekday, yearLength, type Calendar } from './calendar'

export type EventData = { title: string; location: string; notes: string; color: string; start: number; end: number; allDay: boolean }
export type Rule = { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; weekdays: number[]; count?: number; until?: number; festival: 'previous' | 'next' | 'festival' }
export type Series = EventData & { id: string; rule?: Rule; exceptions: Record<string, EventData | null>; cutoff?: number }
export type EventScope = 'one' | 'future' | 'all'
export type Occurrence = EventData & { series: Series; original: number; ordinal: number }
export const minutes = 1440
export const dayOf = (time: number) => Math.floor(time / minutes)

export function eventDraftData(day: number, occurrence?: Occurrence, scope: EventScope = 'one'): EventData {
  if (!occurrence) return { title: '', notes: '', location: '', color: '#52745e', start: day * minutes, end: (day + 1) * minutes, allDay: true }
  const { title, notes, location, color, start, end, allDay } =
    scope === 'all' && occurrence.series.rule ? occurrence.series : occurrence
  return { title, notes, location, color, start, end, allDay }
}

function* starts(cal: Calendar, series: Series, stop: number, earliest: number) {
  const { rule, start } = series
  yield { start, ordinal: 1 }
  if (!rule) return
  const origin = dayOf(start)
  const clock = mod(start, minutes)
  const date = dateParts(cal, origin)
  let ordinal = 1
  function result(day: number) {
    const time = day * minutes + clock
    if (time <= start) return
    if (time >= stop || time >= (series.cutoff ?? Infinity) || day > (rule!.until ?? Infinity) || ordinal >= (rule!.count ?? Infinity)) return false
    return { start: time, ordinal: ++ordinal }
  }
  if (rule.frequency === 'daily') {
    const step = rule.interval
    let index = Math.max(1, Math.ceil((dayOf(earliest) - origin) / step))
    ordinal = index
    for (;; index++) {
      const next = result(origin + index * step)
      if (next === false) return
      if (next) yield next
    }
  }
  if (rule.frequency === 'weekly') {
    const length = cal.weekdays.length
    const firstWeek = origin - weekday(cal, origin)
    const days = [...new Set(rule.weekdays.length ? rule.weekdays : [weekday(cal, origin)])].sort((a, b) => a - b)
    const step = length * rule.interval
    const firstOffset = Math.max(0, Math.floor((dayOf(earliest) - firstWeek) / step))
    if (firstOffset) ordinal += days.filter(day => firstWeek + day > origin).length + (firstOffset - 1) * days.length
    for (let week = firstWeek + firstOffset * step; week * minutes < stop; week += step) {
      for (const day of days) {
        const next = result(week + day)
        if (next === false) return
        if (next) yield next
      }
    }
    return
  }
  const originPeriod = cal.periods.find(p => p.id === date.period)!
  let anchor = origin
  const useEdge = originPeriod.festival && rule.festival !== 'festival'
  if (useEdge) {
    const direction = rule.festival === 'previous' ? -1 : 1
    do { anchor = movePeriod(cal, anchor, direction) } while (cal.periods.find(p => p.id === dateParts(cal, anchor).period)?.festival)
  }
  const anchorDate = dateParts(cal, anchor)
  const yearly = rule.frequency === 'yearly' || (originPeriod.festival && rule.festival === 'festival')
  const horizon = dayOf(Math.min(stop, series.cutoff ?? Infinity)) + yearLength(cal)
  for (let step = useEdge ? 0 : rule.interval; ; step += rule.interval) {
    const target = yearly
      ? { ...anchorDate, year: anchorDate.year + step }
      : dateParts(cal, movePeriod(cal, anchor, step, true))
    const period = cal.periods.find(p => p.id === target.period)!
    const first = dateIndex(cal, { ...target, day: 1 })
    if (first > horizon) return
    const day = useEdge ? (rule.festival === 'previous' ? period.days : 1) : date.day
    if (day > period.days) continue
    const next = result(first + day - 1)
    if (next === false) return
    if (next) yield next
  }
}

export function occurrences(cal: Calendar, events: Series[], from: number, to: number, query = ''): Occurrence[] {
  const lower = from * minutes
  const upper = to * minutes
  const found: Occurrence[] = []
  const needle = query.trim().toLowerCase()
  for (const series of events) {
    const duration = series.end - series.start
    const add = (data: EventData, original: number, ordinal: number) => {
      if (data.start < upper && data.end > lower && [data.title, data.location, data.notes].some(value => value.toLowerCase().includes(needle))) {
        found.push({ ...data, series, original, ordinal })
      }
    }
    const overrides = Object.entries(series.exceptions).filter(([, data]) => data && data.start < upper && data.end > lower)
    const earliest = Math.min(lower - duration, ...overrides.map(([original]) => Number(original)))
    const stop = Math.max(upper, ...overrides.map(([original]) => Number(original) + 1))
    for (const { start, ordinal } of starts(cal, series, stop, earliest)) {
      if (start >= (series.cutoff ?? Infinity)) break
      const data = series.exceptions[start]
      if (data !== null) add(data ?? { ...series, start, end: start + duration }, start, ordinal)
    }
  }
  return found.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
}

export function changeSeries(events: Series[], occurrence: Occurrence, scope: EventScope, data?: EventData, rule?: Rule): Series[] {
  const { original, ordinal } = occurrence
  const series = events.find(event => event.id === occurrence.series.id)
  if (!series) return events
  const replacement = data && { ...data, id: crypto.randomUUID(), rule, exceptions: {} }
  if (!series.rule || scope === 'all') {
    const sameSchedule = replacement?.start === series.start && JSON.stringify(rule) === JSON.stringify(series.rule)
    return events.flatMap(event => event.id !== series.id ? [event] : replacement ? [{
      ...replacement,
      id: series.id,
      exceptions: sameSchedule ? series.exceptions : {},
      cutoff: series.cutoff,
    }] : [])
  }
  if (scope === 'one') {
    return events.map(event => event.id === series.id ? { ...event, exceptions: { ...event.exceptions, [original]: data ?? null } } : event)
  }
  const exceptions = Object.fromEntries(Object.entries(series.exceptions).filter(([key]) => Number(key) < original))
  const remaining = replacement && rule?.count === series.rule.count && rule?.count !== undefined ? rule.count - ordinal + 1 : rule?.count
  const next = replacement && { ...replacement, rule: rule && { ...rule, count: remaining } }
  return events.flatMap(event => event.id !== series.id ? [event] : [
    ...(ordinal > 1 ? [{ ...series, exceptions, cutoff: original }] : []),
    ...(next ? [next] : []),
  ])
}

export function hasOccurrence(cal: Calendar, series: Series, time: number) {
  if (time >= (series.cutoff ?? Infinity)) return false
  for (const item of starts(cal, series, time + 1, time)) {
    if (item.start === time) return true
  }
  return false
}
