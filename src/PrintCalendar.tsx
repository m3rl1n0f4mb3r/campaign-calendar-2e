import { useEffect, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { dateIndex, dateLabel, dateParts, weekday, type Calendar } from './calendar'
import { dayOf, minutes } from './events'
import { DateField } from './DateField'
import { filterPrintEntries, printKinds, printPeriods, type PrintEntry, type PrintKind, type PrintSection } from './printing'

type Props = {
  calendar: Calendar; campaignName: string; current: number; showMoons: boolean
  currentView: PrintSection; viewQuery?: string
  entries: (from: number, to: number, query?: string) => PrintEntry[]
  moonList: (day: number) => ReactNode; moonLegend: ReactNode; close: () => void; help: () => void
}
type Options = { sections: PrintSection[]; query?: string; kinds: ReadonlySet<PrintKind>; moons: boolean; pageBreaks: boolean }
const kinds = Object.keys(printKinds) as PrintKind[]

export function PrintCalendar({ calendar, campaignName, current, showMoons, currentView, viewQuery, entries, moonList, moonLegend, close, help }: Props) {
  const year = dateParts(calendar, current).year
  const [range, setRange] = useState<'current' | 'periods'>('current')
  const [start, setStart] = useState(() => dateIndex(calendar, { year, period: calendar.periods[0].id, day: 1 }))
  const [end, setEnd] = useState(() => dateIndex(calendar, { year, period: calendar.periods[calendar.periods.length - 1].id, day: 1 }))
  const [included, setIncluded] = useState<ReadonlySet<PrintKind>>(() => new Set(kinds))
  const [moons, setMoons] = useState(showMoons)
  const [pageBreaks, setPageBreaks] = useState(true)
  const [report, setReport] = useState<Options>()
  const [error, setError] = useState('')

  useEffect(() => {
    const clearReport = () => setReport(undefined)
    window.addEventListener('afterprint', clearReport)
    return () => window.removeEventListener('afterprint', clearReport)
  }, [])

  return <>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      let sections: PrintSection[]
      try { sections = range === 'current' ? [currentView] : printPeriods(calendar, start, end) }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid print range.'); return }
      setError('')
      flushSync(() => setReport({ sections, kinds: included, moons, pageBreaks, query: range === 'current' ? viewQuery : undefined }))
      window.print()
    }}>
      <button type="button" onClick={help}>Help with printing</button>
      <label>Print range<select value={range} onChange={event => { setRange(event.target.value as typeof range); setError('') }}>
        <option value="current">Current view</option><option value="periods">Choose months or festivals</option>
      </select></label>
      {range === 'periods' && <div className="form-row">
        <DateField calendar={calendar} periodOnly value={start} onChange={setStart} label="First period"/>
        <DateField calendar={calendar} periodOnly value={end} onChange={setEnd} label="Last period"/>
      </div>}
      <fieldset><legend>Include event types</legend>
        {kinds.map(kind => <label key={kind} className="check"><input type="checkbox" checked={included.has(kind)} onChange={event => {
          const next = new Set(included)
          if (event.target.checked) next.add(kind)
          else next.delete(kind)
          setIncluded(next)
        }}/>{printKinds[kind]}</label>)}
      </fieldset>
      {!!calendar.moons.length && <label className="check"><input type="checkbox" checked={moons} onChange={event => setMoons(event.target.checked)}/> Include moons</label>}
      {range === 'periods' && <label className="check"><input type="checkbox" checked={pageBreaks} onChange={event => setPageBreaks(event.target.checked)}/> Start each period on a new page</label>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions"><button type="button" onClick={close}>Close</button><button className="primary">Print</button></div>
    </form>
    {report && createPortal(<article className="calendar-print-report">
      {report.sections.map((section, index) => <section key={section.from} className={report.pageBreaks && index > 0 ? 'print-period-new-page' : undefined}>
        <div className="heading"><div><p className="campaign-name">{campaignName}</p><h1>{section.title}</h1></div></div>
        {report.moons && moonLegend}
        <PrintSectionBody calendar={calendar} section={section}
          events={filterPrintEntries(entries(section.from, section.to, report.query), report.kinds)}
          renderMoons={report.moons ? moonList : undefined}/>
      </section>)}
    </article>, document.body)}
  </>
}

function PrintSectionBody({ calendar, section, events, renderMoons }: {
  calendar: Calendar; section: PrintSection; events: PrintEntry[]; renderMoons?: (day: number) => ReactNode
}) {
  const { from, to, grid } = section
  if (!grid) return <div className="agenda">
    {from + 1 === to && renderMoons?.(from)}
    {events.length ? events.map(event => {
      const date = Math.max(from, dayOf(event.start))
      return <div className="agenda-row" key={event.key}>
        <div><time>{dateLabel(calendar, date)}</time>{from + 1 !== to && renderMoons?.(date)}</div>
        <div>{event.title}{(event.time || event.location) && <p>{[event.time, event.location].filter(Boolean).join(' · ')}</p>}</div>
      </div>
    }) : <p>No events in this date range.</p>}
  </div>

  const columns = calendar.weekdays.length
  const first = from - weekday(calendar, from)
  const rows = Math.ceil((to - first) / columns)
  return <div className="calendar-grid printable-grid">
    <div className="calendar-grid-header"><div className="calendar-grid-row">{calendar.weekdays.map((label, index) =>
      <div key={index} className="weekday">{label}</div>
    )}</div></div>
    <div className="calendar-grid-body">{Array.from({ length: rows }, (_, row) =>
      <div className="calendar-grid-row" key={row}>{Array.from({ length: columns }, (_, column) => {
        const day = first + row * columns + column
        if (day < from || day >= to) return <div key={day} className="cell outside"/>
        return <div className="cell" key={day}>
          <div className="cell-heading"><strong>{dateParts(calendar, day).day}</strong>{renderMoons?.(day)}</div>
          {events.filter(event => event.start < (day + 1) * minutes && event.end > day * minutes).map(event =>
            <div className="event-chip" key={event.key}><span>{event.time && event.kind === 'timed' && `${event.time} `}{event.title}</span></div>
          )}
        </div>
      })}</div>
    )}</div>
  </div>
}
