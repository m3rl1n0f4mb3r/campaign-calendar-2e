import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { dateIndex, dateLabel, dateParts, mod, moonColor, moonPhase, movePeriod, phaseNames, phaseSymbols, weekday, yearLabel } from './calendar'
import { changeSeries, minutes, occurrences, type EventData, type Occurrence, type Rule } from './events'
import { deleteActiveCampaign, exportCampaign, key, newCampaign, parseCampaignBackup, parseStore, restoreActiveCampaign, saveIfCurrent, type Campaign, type Store } from './storage'
import { dragonlance, greyhawk, lanceSource } from './presets'
import { DateField } from './DateField'
import { EventEditor, type Scope } from './EventEditor'
import { UserGuide, type GuideTopic } from './UserGuide'
import { DomainPanel, type ReceiptLink } from './DomainPanel'
import { dominionEntries, turnEntries } from './domain'
import { CalendarEditor } from './CalendarEditor'
import './style.css'

type View = 'Month' | 'Week' | 'Day' | 'Agenda'
type Panel = 'new' | 'calendar' | 'event' | 'jump' | 'clock' | 'data' | 'delete' | 'search' | 'domains'
const views: View[] = ['Month', 'Week', 'Day', 'Agenda']

function initialize() {
  const campaign = newCampaign('Example Campaign')
  const fallback: Store = { version: 1, active: campaign.id, campaigns: [campaign] }
  let saved: string | null = null
  try {
    saved = localStorage.getItem(key)
    return { store: saved ? parseStore(saved) : fallback, error: '', locked: false, raw: saved }
  } catch {
    return { store: fallback, error: 'Saved data could not be read. Restore a backup, or use Data to start fresh.', locked: true, raw: saved }
  }
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} aria-label={title} onCancel={e => { e.preventDefault(); close() }}>
    <header className="dialog-header"><h2>{title}</h2><button aria-label="Close dialog" onClick={close}>×</button></header>
    {children}
  </dialog>
}

function App() {
  const [initial] = useState(initialize)
  const [guide, setGuide] = useState<GuideTopic>()
  const helpOpener = useRef<HTMLElement | null>(null)
  function openGuide(topic: GuideTopic) {
    helpOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setGuide(topic)
  }
  const [store, setStore] = useState(initial.store)
  const [raw, setRaw] = useState(initial.raw)
  const [locked, setLocked] = useState(initial.locked)
  const [error, setError] = useState(initial.error)
  const campaign = store.campaigns.find(item => item.id === store.active)!
  const cal = campaign.calendar
  const [selected, setSelected] = useState(campaign.current)
  const [view, setView] = useState<View>('Month')
  const [showMoons, setShowMoons] = useState(false)
  const [panel, setPanel] = useState<Panel>()
  const [dominionEvent, setDominionEvent] = useState<{ holdingId: string; id: string }>()
  const [receipt, setReceipt] = useState<ReceiptLink>()
  const [editing, setEditing] = useState<Occurrence>()
  const [draftDate, setDraftDate] = useState(selected)
  const [query, setQuery] = useState('')
  const [searchFrom, setSearchFrom] = useState(selected)
  const [searchTo, setSearchTo] = useState(selected + 29)
  const [search, setSearch] = useState<{ query: string; from: number; to: number }>()
  const [restore, setRestore] = useState<Campaign>()
  const [deleting, setDeleting] = useState(false)
  const restoreRequest = useRef(0)
  const [preset, setPreset] = useState('generic')
  const [campaignName, setCampaignName] = useState('')
  const dialogTitle = { new: 'New campaign', calendar: 'Calendar settings', event: editing ? 'Edit event' : 'New event', jump: 'Jump to date', clock: 'Set campaign date', data: 'Campaign data', delete: 'Delete campaign', search: 'Search events', domains: 'Domain Play' }

  function syncSaved(value: string | null) {
    setRaw(value)
    if (value === null) {
      setLocked(true)
      setError('Saved data was removed in another tab. Restore a backup or start fresh.')
      return
    }
    try {
      const latest = parseStore(value)
      setStore(latest)
      setLocked(false)
      if (store.active !== latest.active) {
        setSelected(latest.campaigns.find(item => item.id === latest.active)!.current)
        setSearch(undefined)
        close()
      }
    } catch {
      setLocked(true)
      setError('Saved data could not be read. Restore a backup or start fresh.')
    }
  }

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.storageArea !== localStorage || (event.key !== key && event.key !== null)) return
      const value = localStorage.getItem(key)
      if (value === raw) return
      syncSaved(value)
      if (panel && panel !== 'domains') close()
      setError('Campaign data changed in another tab. Review the latest data before saving.')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  })

  async function commit(next: Store, replace = false) {
    if (locked && !replace) return false
    const write = () => saveIfCurrent(localStorage, raw, next)
    try {
      if (!navigator.locks && [...store.campaigns, ...next.campaigns].some(item => item.holdings?.length)) {
        setError('Domain saves require a browser with cross-tab locking on a secure connection.')
        return false
      }
      const result = navigator.locks ? await navigator.locks.request(key, write) : write()
      if (!result.saved) {
        syncSaved(result.raw)
        if (panel !== 'domains') close()
        setError('Campaign data changed in another tab. Review the latest data before saving.')
        return false
      }
      setRaw(result.raw)
      setStore(parseStore(result.raw))
      setError('')
      setLocked(false)
      return true
    } catch (cause) {
      setError(cause instanceof Error && cause.name === 'ZodError' ? 'The changes contain invalid or out-of-range data.' : 'Could not save to browser storage. Your previous data is still in place.')
      return false
    }
  }

  const saveCampaign = (next: Campaign) => commit({ ...store, campaigns: store.campaigns.map(item => item.id === next.id ? next : item) })
  const close = () => { restoreRequest.current++; setPanel(undefined); setRestore(undefined) }
  function open(next: Panel) {
    setPanel(next)
    setDraftDate(next === 'clock' ? campaign.current : selected)
    if (next === 'domains') { setReceipt(undefined); setDominionEvent(undefined) }
    if (next === 'new') { setCampaignName(''); setPreset('generic') }
    if (next === 'search') { setSearchFrom(selected); setSearchTo(selected + 29) }
  }
  function openEvent(event?: Occurrence, day = selected) {
    setSelected(day)
    setEditing(event)
    open('event')
  }
  async function setClock(day: number) {
    if (await saveCampaign({ ...campaign, current: day })) { setSelected(day); setSearch(undefined); close() }
  }
  function backup() {
    const blob = new Blob([exportCampaign(campaign)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${campaign.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'campaign'}-backup.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  async function saveEvent(scope: Scope, data?: EventData, rule?: Rule) {
    const events = editing ? changeSeries(campaign.events, editing, scope, data, rule)
      : data ? [...campaign.events, { ...data, rule, id: crypto.randomUUID(), exceptions: {} }] : campaign.events
    if (await saveCampaign({ ...campaign, events })) close()
  }

  const date = dateParts(cal, selected)
  const period = cal.periods.find(p => p.id === date.period)!
  const first = dateIndex(cal, { ...date, day: 1 })
  const weekLength = cal.weekdays.length
  const monthStart = first - weekday(cal, first)
  const weekStart = selected - weekday(cal, selected)
  const monthEnd = monthStart + Math.ceil((first + period.days - monthStart) / weekLength) * weekLength
  const from = search?.from ?? (view === 'Month' ? monthStart : view === 'Week' ? weekStart : selected)
  const to = search ? search.to + 1 : view === 'Month' ? monthEnd : view === 'Week' ? weekStart + weekLength : selected + (view === 'Agenda' ? 30 : 1)
  const weekGrid = !search && (view === 'Month' || view === 'Week')
  const showCalendarMoons = showMoons && cal.moons.length > 0
  const printRange = view === 'Month' && !search ? '' : from + 1 === to
    ? dateLabel(cal, from)
    : `${dateLabel(cal, from)} – ${dateLabel(cal, to - 1)}`
  const list = occurrences(cal, campaign.events, from, to, search?.query)
  const selectedEvents = occurrences(cal, campaign.events, selected, selected + 1)
  const navigate = (direction: number) => setSelected(view === 'Month' ? movePeriod(cal, selected, direction) : selected + direction * (view === 'Week' ? weekLength : view === 'Agenda' ? 30 : 1))
  const timeLabel = (event: Occurrence) => event.allDay ? 'All day' : `${String(Math.floor(mod(event.start, minutes) / 60)).padStart(2, '0')}:${String(mod(event.start, 60)).padStart(2, '0')}`
  const eventButton = (event: Occurrence, day: number, compact = false) => <button key={`${event.series.id}:${event.original}`} className={compact ? 'event-chip' : 'event-item'} style={{ borderLeftColor: event.color }} onClick={() => openEvent(event, day)}>
    <span>{!event.allDay && compact && <small>{timeLabel(event)} </small>}{event.title}</span>
    {!compact && <small>{timeLabel(event)}{event.location && ` · ${event.location}`}</small>}
  </button>
  function calendarEntries(events: Occurrence[], start: number, end: number, term?: string) {
    const entries = events.map(event => ({
      key: `${event.series.id}:${event.original}`, start: event.start, end: event.end,
      render: (day: number, compact = false) => eventButton(event, day, compact),
    }))
    for (const entry of turnEntries(cal, campaign.holdings ?? [], start, end, term)) {
      const entryKey = `turn:${entry.holdingId}:${entry.month.year}:${entry.month.period}`
      entries.push({
        key: entryKey, start: entry.day * minutes, end: (entry.day + 1) * minutes,
        render: (_, compact = false) => <button key={entryKey} className={compact ? 'event-chip domain-event' : 'event-item domain-event'} onClick={() => {
          setDominionEvent(undefined)
          setReceipt(entry)
          setPanel('domains')
        }}><span>{entry.title}</span></button>,
      })
    }
    for (const entry of dominionEntries(campaign.holdings ?? [], start, end, term)) {
      const entryKey = `dominion:${entry.holdingId}:${entry.id}`
      entries.push({ key: entryKey, start: entry.day * minutes, end: (entry.day + 1) * minutes,
        render: (_, compact = false) => <button key={entryKey} className={compact ? 'event-chip domain-event' : 'event-item domain-event'} onClick={() => {
          setReceipt(undefined)
          setDominionEvent(entry)
          setPanel('domains')
        }}><span>{entry.title}</span>{!compact && <small>Dominion event · {entry.status}</small>}</button>,
      })
    }
    return entries.sort((a, b) => a.start - b.start)
  }
  const entries = calendarEntries(list, from, to, search?.query)
  const selectedEntries = calendarEntries(selectedEvents, selected, selected + 1)
  const moonList = (day: number) => <ul className="calendar-moons" aria-label="Moon phases">{cal.moons.map((moon, index) => {
    const phase = moonPhase(moon, day)
    const label = `${moon.name}: ${phaseNames[phase]}`
    return <li key={index}><span className={`moon-disc phase-${phase}`} style={{ color: moonColor(moon, index) }} role="img" aria-label={label} title={label}/></li>
  })}</ul>

  function calendarCell(day: number) {
    const parts = dateParts(cal, day)
    const outside = view === 'Month' && (day < first || day >= first + period.days)
    return <div key={day} className={`cell${outside ? ' outside' : ''}${day === selected ? ' selected' : ''}`}>
      <div className="cell-heading"><button className={day === campaign.current ? 'current-day' : ''} aria-pressed={day === selected} aria-label={dateLabel(cal, day)} onClick={() => setSelected(day)}>{parts.day}</button>
        {showCalendarMoons && moonList(day)}
        <button className="cell-add" aria-label={`Add event on ${dateLabel(cal, day)}`} onClick={() => openEvent(undefined, day)}>+</button>
      </div>
      {entries.filter(entry => entry.start < (day + 1) * minutes && entry.end > day * minutes).map(entry => entry.render(day, true))}
    </div>
  }

  return <>
    <header className="masthead">
      <div className="brand"><span aria-hidden="true">◈</span> Campaign Calendar</div>
      <div className="header-actions"><button onClick={() => openGuide('get-started')}>Help</button><button onClick={() => open('search')}>Search</button><button onClick={() => open('data')}>Data</button></div>
    </header>
    {error && <p role="alert" className="error global-error">{error}</p>}
    <main className="layout">
      <aside className="sidebar">
        <label htmlFor="campaign-select">Campaign</label>
        <select id="campaign-select" value={store.active} onChange={async e => {
          const active = e.target.value
          if (await commit({ ...store, active })) { setSelected(store.campaigns.find(item => item.id === active)!.current); setSearch(undefined) }
        }}>{store.campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button className="sidebar-action" onClick={() => open('new')}>＋ New campaign</button>
        <button className="sidebar-action" onClick={() => open('calendar')}>Calendar settings</button>
        <button className="sidebar-action" onClick={() => open('domains')}>Domain Play</button>
        <section className="clock-card">
          <h2>Campaign date</h2><p>{dateLabel(cal, campaign.current)}</p>
          <button className="sidebar-action" onClick={() => open('clock')}>Set date</button>
          <button onClick={() => setClock(campaign.current + 1)}>Advance one day</button>
        </section>
      </aside>
      <section className="workspace">
        <div className="heading">
          <div><p className="campaign-name">{campaign.name}</p><h1>{search ? 'Search results' : `${period.name} · ${yearLabel(cal, date.year)}`}</h1>
            {printRange && <p className="print-only">{printRange}</p>}
          </div>
          <div className="button-group calendar-actions"><button onClick={() => window.print()}>Print</button><button className="primary" onClick={() => openEvent()}>＋ New event</button></div>
        </div>
        <div className="toolbar">
          {search ? <><span>{search.query || 'All events'} · {dateLabel(cal, search.from)} – {dateLabel(cal, search.to)}</span><button onClick={() => setSearch(undefined)}>Back to calendar</button></> : <>
            <div className="button-group"><button aria-label="Previous period" onClick={() => navigate(-1)}>‹</button><button aria-label="Next period" onClick={() => navigate(1)}>›</button><button onClick={() => setSelected(campaign.current)}>Campaign date</button><button onClick={() => open('jump')}>Jump</button></div>
            <div className="button-group view-tabs" aria-label="Calendar view">{views.map(item => <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
          </>}
          {cal.moons.length > 0 && <label className="moon-toggle"><input type="checkbox" checked={showMoons} onChange={event => setShowMoons(event.target.checked)}/> Show moons</label>}
        </div>
        {showCalendarMoons && <ul className="moon-legend" aria-label="Moons in display order">{cal.moons.map((moon, index) =>
          <li key={index}><span className="moon-disc phase-4" style={{ color: moonColor(moon, index) }} aria-hidden="true"/>{moon.name}</li>
        )}</ul>}
        {weekGrid ? <div className="grid-scroll"><div className="calendar-grid printable-grid" style={{ gridTemplateColumns: `repeat(${weekLength}, minmax(${showCalendarMoons ? '112px' : '84px'}, 1fr))` }}>
          <div className="calendar-grid-header"><div className="calendar-grid-row">{cal.weekdays.map((name, i) => <div className="weekday" key={i}>{name}</div>)}</div></div>
          <div className="calendar-grid-body">{Array.from({ length: (to - from) / weekLength }, (_, row) =>
            <div className="calendar-grid-row" key={from + row * weekLength}>
              {Array.from({ length: weekLength }, (_, column) => calendarCell(from + row * weekLength + column))}
            </div>
          )}</div>
        </div></div> : <div className="agenda">
          {view === 'Day' && !search && <h2>{cal.weekdays[weekday(cal, selected)]}, {dateLabel(cal, selected)}</h2>}
          {view === 'Day' && !search && showCalendarMoons && moonList(selected)}
          {entries.length ? entries.map(entry => {
            const day = Math.floor(entry.start / minutes)
            return <div className="agenda-row" key={entry.key}>
              <div><time>{dateLabel(cal, day)}</time>{(search || view === 'Agenda') && showCalendarMoons && moonList(day)}</div>{entry.render(day)}
            </div>
          }) : <p className="muted">No events in this date range.</p>}
        </div>}
      </section>
      <aside className="details">
        <h2>{dateLabel(cal, selected)}</h2><p className="muted">{cal.weekdays[weekday(cal, selected)]}</p>
        {cal.moons.length > 0 && <section><h3>Moon phases</h3>{cal.moons.map((moon, index) => {
          const phase = moonPhase(moon, selected)
          return <div className="moon" key={index}><span aria-hidden="true" style={{ color: moonColor(moon, index) }}>{phaseSymbols[phase]}</span><div><strong>{moon.name}</strong><small>{phaseNames[phase]}</small></div></div>
        })}</section>}
        <section><h3>Events</h3>{selectedEntries.length ? selectedEntries.map(entry => entry.render(selected)) : <p className="muted">No events on this date.</p>}</section>
      </aside>
    </main>
    {panel && <Dialog key={panel} title={dialogTitle[panel]} close={close}>
      {error && <p role="alert" className="error">{error}</p>}
      {panel === 'domains' && <DomainPanel campaign={campaign} revision={raw} receipt={receipt} dominionEvent={dominionEvent} help={openGuide} backup={backup} save={holdings => saveCampaign({ ...campaign, holdings })}/>}
      {panel === 'event' && <EventEditor calendar={cal} day={selected} event={editing} save={saveEvent} close={close}/>}
      {panel === 'calendar' && <CalendarEditor campaign={campaign} close={close} backup={backup} save={async next => {
        if (await saveCampaign(next)) { setSelected(next.current); setSearch(undefined); close() }
      }}/>}
      {(panel === 'jump' || panel === 'clock') && <form className="form" onSubmit={e => {
        e.preventDefault()
        if (panel === 'clock') setClock(draftDate)
        else { setSelected(draftDate); setSearch(undefined); close() }
      }}><DateField calendar={cal} label="Date" value={draftDate} onChange={setDraftDate}/><div className="actions"><button className="primary">{panel === 'clock' ? 'Set campaign date' : 'Go to date'}</button></div></form>}
      {panel === 'new' && <form className="form" onSubmit={async e => {
        e.preventDefault()
        if (!campaignName.trim()) return
        const sample = preset === 'dragonlance' ? dragonlance() : undefined
        const created = newCampaign(campaignName.trim(), sample?.calendar ?? (preset === 'greyhawk' ? greyhawk() : undefined), sample?.current)
        if (await commit({ ...store, active: created.id, campaigns: [...store.campaigns, created] })) { setSelected(created.current); setSearch(undefined); close() }
      }}><label>Campaign name<input autoFocus maxLength={120} required value={campaignName} onChange={e => setCampaignName(e.target.value)}/></label>
      <label>Calendar template<select value={preset} onChange={e => setPreset(e.target.value)}><option value="generic">Generic calendar</option><option value="dragonlance">Dragonlance · pre-Cataclysm example</option><option value="greyhawk">Greyhawk · festival calendar</option></select></label>
      {preset === 'dragonlance' && <p>Moon cycles come from <a href={lanceSource} target="_blank" rel="noreferrer">Tales of the Lance</a>. Replace the sample phase anchors with your campaign’s phases in Calendar settings.</p>}
      <div className="actions"><button className="primary">Create campaign</button></div></form>}
      {panel === 'data' && <div className="form"><button disabled={locked} onClick={backup}>Back up {campaign.name}</button>
        {locked && <button className="danger" onClick={async () => {
          if (window.confirm('Replace unreadable browser data with a new campaign?') && await commit(store, true)) close()
        }}>Start fresh</button>}
        <label>Restore campaign backup<input type="file" accept=".json,application/json" onChange={async e => {
          const file = e.target.files?.[0]
          const request = ++restoreRequest.current
          setRestore(undefined)
          if (!file) return
          try {
            const parsed = parseCampaignBackup(await file.text())
            if (request === restoreRequest.current) { setRestore(parsed); setError('') }
          } catch {
            if (request === restoreRequest.current) setError('This file is not a valid Campaign Calendar backup.')
          }
        }}/></label>
        {restore && <><p className="warning">{locked
          ? <>Restore <strong>{restore.name}</strong> and overwrite the unreadable app data?</>
          : <>Replace the active campaign <strong>{campaign.name}</strong> with the backup of <strong>{restore.name}</strong>?</>}</p><button className="primary" onClick={async () => {
          if (await commit(restoreActiveCampaign(store, restore), true)) { setSelected(restore.current); setSearch(undefined); close() }
        }}>{locked ? 'Restore campaign' : 'Replace active campaign'}</button></>}
        {!locked && <div className="actions"><button className="danger" onClick={() => {
          close()
          open('delete')
        }}>Delete active campaign</button></div>}
      </div>}
      {panel === 'delete' && <div className="form">
        <p className="warning">Delete <strong>{campaign.name}</strong> and its calendar settings, events, and domain records from this browser?</p>
        {store.campaigns.length === 1 && <p>An empty <strong>Example Campaign</strong> will open after deletion.</p>}
        <div className="actions">
          <button autoFocus disabled={deleting} onClick={() => open('data')}>Cancel</button>
          <button disabled={deleting} onClick={backup}>Download backup</button>
          <button className="danger" disabled={deleting} onClick={async () => {
            setDeleting(true)
            try {
              const next = deleteActiveCampaign(store)
              if (await commit(next)) {
                setSelected(next.campaigns[0].current)
                setSearch(undefined)
                close()
              }
            } finally { setDeleting(false) }
          }}>Delete campaign</button>
        </div>
      </div>}
      {panel === 'search' && <form className="form" onSubmit={e => {
        e.preventDefault()
        if (searchTo < searchFrom) { setError('The search end must be on or after the start.'); return }
        setError(''); setSearch({ query, from: searchFrom, to: searchTo }); close()
      }}><label>Title, location, or notes<input autoFocus value={query} onChange={e => setQuery(e.target.value)}/></label>
        <DateField calendar={cal} label="From" value={searchFrom} onChange={setSearchFrom}/><DateField calendar={cal} label="Through" value={searchTo} onChange={setSearchTo}/><div className="actions"><button className="primary">Search</button></div>
      </form>}
    </Dialog>}
    {guide && <UserGuide topic={guide} onClose={() => {
      setGuide(undefined)
      if (helpOpener.current?.isConnected) helpOpener.current.focus()
    }}/>}
  </>
}

if (import.meta.env.VITE_VERCEL_ENV === 'production') {
  inject({ beforeSend: event => {
    if (event.type !== 'pageview') return null
    // This app has one route. Report its origin without URL parameters or fragments.
    return { ...event, url: new URL('/', window.location.origin).href }
  } })
}

createRoot(document.getElementById('root')!).render(<App/>)
