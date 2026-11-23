import { useState } from 'react'
import { dateIndex, dateLabel, dateParts, moonPhase, movePeriod, phaseNames, weekday, yearLabel } from './calendar'
import { minutes, occurrences } from './events'
import { constructionEntries, dominionEntries, turnEntries } from './domain'
import type { migrate } from './migration'
import type { Campaign } from './storage'

export function MigrationCalendar({ original, preview }: { original: Campaign; preview: ReturnType<typeof migrate> }) {
  const proposed = preview.campaign
  const changedPeriod = proposed.calendar.periods.find((period, index) =>
    period.id !== original.calendar.periods[index]?.id ||
    period.days !== original.calendar.periods[index]?.days ||
    period.festival !== original.calendar.periods[index]?.festival)
  const initial = preview.affected[0]?.after ?? (changedPeriod
    ? dateIndex(proposed.calendar, { ...dateParts(proposed.calendar, proposed.current), period: changedPeriod.id, day: 1 })
    : proposed.current)
  const [side, setSide] = useState<'before' | 'after'>('after')
  const [selected, setSelected] = useState(initial)
  const campaign = side === 'after' ? proposed : original
  const cal = campaign.calendar
  const date = dateParts(cal, selected)
  const period = cal.periods.find(item => item.id === date.period)!
  const first = dateIndex(cal, { ...date, day: 1 })
  const offset = weekday(cal, first)
  const columns = cal.weekdays.length
  const slots = Math.ceil((offset + period.days) / columns) * columns
  const affected = new Set(preview.affected.map(change => change[side]))
  const showEvents = side === 'before' || preview.errors.length === 0
  const events = showEvents ? occurrences(cal, campaign.events, first, first + period.days) : []
  const dominion = showEvents ? dominionEntries(campaign.holdings ?? [], first, first + period.days) : []
  const construction = showEvents ? constructionEntries(cal, campaign.holdings ?? [], first, first + period.days) : []
  const turns = showEvents ? turnEntries(cal, campaign.holdings ?? [], first, first + period.days) : []

  function switchSide(next: 'before' | 'after') {
    if (next === side) return
    const target = next === 'after' ? proposed : original
    const mapped = preview.affected.find(change => change[side] === selected)
    const samePeriod = target.calendar.periods.find(item => item.id === date.period)
    setSelected(mapped?.[next] ?? (samePeriod
      ? dateIndex(target.calendar, { ...date, day: Math.min(date.day, samePeriod.days) })
      : target.current))
    setSide(next)
  }

  return <section className="form" aria-label="Calendar migration preview">
    <div className="toolbar migration-toolbar">
      <div className="button-group view-tabs" aria-label="Calendar version">
        <button aria-pressed={side === 'before'} onClick={() => switchSide('before')}>Current</button>
        <button aria-pressed={side === 'after'} onClick={() => switchSide('after')}>Proposed</button>
      </div>
      <div className="button-group">
        <button aria-label="Previous preview period" onClick={() => setSelected(movePeriod(cal, selected, -1))}>‹</button>
        <button aria-label="Next preview period" onClick={() => setSelected(movePeriod(cal, selected, 1))}>›</button>
      </div>
    </div>
    <div className="migration-heading"><h3>{period.name} · {yearLabel(cal, date.year)}</h3><span>{period.days} days</span></div>
    <div className="grid-scroll"><div className="calendar-grid migration-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
      {cal.weekdays.map((name, index) => <div className="weekday" key={index} title={name}>{name}</div>)}
      {Array.from({ length: slots }, (_, index) => {
        const day = first + index - offset
        if (day < first || day >= first + period.days) return <div className="cell outside" key={day} aria-hidden="true"/>
        return <div key={day} className={`cell${day === selected ? ' selected' : ''}${affected.has(day) ? ' migration-affected' : ''}`}>
          <div className="cell-heading"><button className={day === campaign.current ? 'current-day' : ''} aria-pressed={day === selected} aria-label={dateLabel(cal, day)} onClick={() => setSelected(day)}>{day - first + 1}</button></div>
          {events.filter(event => event.start < (day + 1) * minutes && event.end > day * minutes).map(event =>
            <div className="event-chip" key={`${event.series.id}:${event.original}`} title={event.title} style={{ borderLeftColor: event.color }}><span>{event.title}</span></div>)}
          {dominion.filter(event => event.day === day).map(event =>
            <div className="event-chip domain-event" key={`dominion:${event.holdingId}:${event.id}`} title={event.title}><span>{event.title}</span></div>)}
          {construction.filter(entry => entry.day === day).map(entry =>
            <div className="event-chip domain-event" key={`construction:${entry.holdingId}:${entry.projectId}:${entry.id}`} title={entry.title}><span>{entry.title}</span></div>)}
          {turns.filter(turn => turn.day === day).map(turn =>
            <div className="event-chip domain-event" key={`turn:${turn.holdingId}`} title={turn.title}><span>{turn.title}</span></div>)}
        </div>
      })}
    </div></div>
    {affected.size > 0 && <p className="muted">Gold squares mark dates affected by the migration.</p>}
    {!showEvents && <p className="muted">Resolve the migration errors to preview proposed events.</p>}
    <div className="migration-day">
      <strong>{dateLabel(cal, selected)}</strong>
      {selected === campaign.current && <span> · Campaign date</span>}
      {cal.moons.length > 0 && <ul>{cal.moons.map((moon, index) => <li key={index}>{moon.name} · {phaseNames[moonPhase(moon, selected)]}</li>)}</ul>}
    </div>
  </section>
}
