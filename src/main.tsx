import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { dateIndex, dateLabel, dateParts, mod, moonPhase, movePeriod, phaseNames, phaseSymbols, weekday, yearLabel } from './calendar'
import { changeSeries, minutes, occurrences, type EventData, type Occurrence, type Rule } from './events'
import { exportCampaign, key, newCampaign, parseCampaignBackup, parseStore, restoreActiveCampaign, saveStore, type Campaign, type Store } from './storage'
import { dragonlance, greyhawk, lanceSource } from './presets'
import { DateField } from './DateField'
import { EventEditor, type Scope } from './EventEditor'
import { CalendarEditor } from './CalendarEditor'
import './style.css'

type View = 'Month' | 'Week' | 'Day' | 'Agenda'
type Panel = 'new' | 'calendar' | 'event' | 'jump' | 'clock' | 'data' | 'search'
const views: View[] = ['Month', 'Week', 'Day', 'Agenda']

function initialize() {
  const campaign = newCampaign('Example Campaign')
  const fallback: Store = { version: 1, active: campaign.id, campaigns: [campaign] }
  try {
    const saved = localStorage.getItem(key)
    return { store: saved ? parseStore(saved) : fallback, error: '', locked: false }
  } catch {
    return { store: fallback, error: 'Saved data could not be read. Restore a backup, or use Data to start fresh.', locked: true }
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
  const [store, setStore] = useState(initial.store)
  const [locked, setLocked] = useState(initial.locked)
  const [error, setError] = useState(initial.error)
  const campaign = store.campaigns.find(item => item.id === store.active)!
  const cal = campaign.calendar
  const [selected, setSelected] = useState(campaign.current)
  const [view, setView] = useState<View>('Month')
  const [panel, setPanel] = useState<Panel>()
  const [editing, setEditing] = useState<Occurrence>()
  const [draftDate, setDraftDate] = useState(selected)
  const [query, setQuery] = useState('')
  const [searchFrom, setSearchFrom] = useState(selected)
  const [searchTo, setSearchTo] = useState(selected + 29)
  const [search, setSearch] = useState<{ query: string; from: number; to: number }>()
  const [restore, setRestore] = useState<Campaign>()
  const restoreRequest = useRef(0)
  const [preset, setPreset] = useState('generic')
  const [campaignName, setCampaignName] = useState('')
  const dialogTitle = { new: 'New campaign', calendar: 'Calendar settings', event: editing ? 'Edit event' : 'New event', jump: 'Jump to date', clock: 'Set campaign date', data: 'Campaign data', search: 'Search events' }

  function commit(next: Store, replace = false) {
    if (locked && !replace) { setError(initial.error); return false }
    try {
      saveStore(localStorage, next)
      setStore(next)
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
    if (next === 'new') { setCampaignName(''); setPreset('generic') }
    if (next === 'search') { setSearchFrom(selected); setSearchTo(selected + 29) }
  }
  function openEvent(event?: Occurrence, day = selected) {
    setSelected(day)
    setEditing(event)
    open('event')
  }
  function setClock(day: number) {
    if (saveCampaign({ ...campaign, current: day })) { setSelected(day); setSearch(undefined); close() }
  }
  function backup() {
    const blob = new Blob([exportCampaign(campaign)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${campaign.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'campaign'}-backup.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  function saveEvent(scope: Scope, data?: EventData, rule?: Rule) {
    const events = editing ? changeSeries(campaign.events, editing, scope, data, rule)
      : data ? [...campaign.events, { ...data, rule, id: crypto.randomUUID(), exceptions: {} }] : campaign.events
    if (saveCampaign({ ...campaign, events })) close()
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
  const list = occurrences(cal, campaign.events, from, to, search?.query)
  const selectedEvents = occurrences(cal, campaign.events, selected, selected + 1)
  const navigate = (direction: number) => setSelected(view === 'Month' ? movePeriod(cal, selected, direction) : selected + direction * (view === 'Week' ? weekLength : view === 'Agenda' ? 30 : 1))
  const timeLabel = (event: Occurrence) => event.allDay ? 'All day' : `${String(Math.floor(mod(event.start, minutes) / 60)).padStart(2, '0')}:${String(mod(event.start, 60)).padStart(2, '0')}`
  const eventButton = (event: Occurrence, day: number, compact = false) => <button key={`${event.series.id}:${event.original}`} className={compact ? 'event-chip' : 'event-item'} style={{ borderLeftColor: event.color }} onClick={() => openEvent(event, day)}>
    <span>{!event.allDay && compact && <small>{timeLabel(event)} </small>}{event.title}</span>
    {!compact && <small>{timeLabel(event)}{event.location && ` · ${event.location}`}</small>}
  </button>

  return <>
    <header className="masthead">
      <div className="brand"><span aria-hidden="true">◈</span> Campaign Calendar</div>
      <div className="header-actions"><button onClick={() => open('search')}>Search</button><button onClick={() => open('data')}>Data</button></div>
    </header>
    {error && <p role="alert" className="error global-error">{error}</p>}
    <main className="layout">
      <aside className="sidebar">
        <label htmlFor="campaign-select">Campaign</label>
        <select id="campaign-select" value={store.active} onChange={e => {
          const active = e.target.value
          if (commit({ ...store, active })) { setSelected(store.campaigns.find(item => item.id === active)!.current); setSearch(undefined) }
        }}>{store.campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button className="sidebar-action" onClick={() => open('new')}>＋ New campaign</button>
        <button className="sidebar-action" onClick={() => open('calendar')}>Calendar settings</button>
        <section className="clock-card">
          <h2>Campaign date</h2><p>{dateLabel(cal, campaign.current)}</p>
          <button className="sidebar-action" onClick={() => open('clock')}>Set date</button>
          <button onClick={() => setClock(campaign.current + 1)}>Advance one day</button>
        </section>
      </aside>
      <section className="workspace">
        <div className="heading">
          <div><p className="campaign-name">{campaign.name}</p><h1>{search ? 'Search results' : `${period.name} · ${yearLabel(cal, date.year)}`}</h1></div>
          <button className="primary" onClick={() => openEvent()}>＋ New event</button>
        </div>
        <div className="toolbar">
          {search ? <><span>{search.query || 'All events'} · {dateLabel(cal, search.from)} – {dateLabel(cal, search.to)}</span><button onClick={() => setSearch(undefined)}>Back to calendar</button></> : <>
            <div className="button-group"><button aria-label="Previous period" onClick={() => navigate(-1)}>‹</button><button aria-label="Next period" onClick={() => navigate(1)}>›</button><button onClick={() => setSelected(campaign.current)}>Campaign date</button><button onClick={() => open('jump')}>Jump</button></div>
            <div className="button-group view-tabs" aria-label="Calendar view">{views.map(item => <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
          </>}
        </div>
        {weekGrid ? <div className="grid-scroll"><div className="calendar-grid" style={{ gridTemplateColumns: `repeat(${weekLength}, minmax(84px, 1fr))` }}>
          {cal.weekdays.map((name, i) => <div className="weekday" key={i}>{name}</div>)}
          {Array.from({ length: to - from }, (_, i) => {
            const day = from + i
            const parts = dateParts(cal, day)
            const outside = view === 'Month' && parts.period !== date.period
            return <div key={day} className={`cell${outside ? ' outside' : ''}${day === selected ? ' selected' : ''}`}>
              <div className="cell-heading"><button className={day === campaign.current ? 'current-day' : ''} aria-pressed={day === selected} aria-label={dateLabel(cal, day)} onClick={() => setSelected(day)}>{parts.day}</button>
              <button className="cell-add" aria-label={`Add event on ${dateLabel(cal, day)}`} onClick={() => openEvent(undefined, day)}>+</button></div>
              {list.filter(event => event.start < (day + 1) * minutes && event.end > day * minutes).map(event => eventButton(event, day, true))}
            </div>
          })}
        </div></div> : <div className="agenda">
          {view === 'Day' && !search && <h2>{cal.weekdays[weekday(cal, selected)]}, {dateLabel(cal, selected)}</h2>}
          {list.length ? list.map(event => <div className="agenda-row" key={`${event.series.id}:${event.original}`}>
            <time>{dateLabel(cal, Math.floor(event.start / minutes))}</time>{eventButton(event, Math.floor(event.start / minutes))}
          </div>) : <p className="muted">No events in this date range.</p>}
        </div>}
      </section>
      <aside className="details">
        <h2>{dateLabel(cal, selected)}</h2><p className="muted">{cal.weekdays[weekday(cal, selected)]}</p>
        {cal.moons.length > 0 && <section><h3>Moon phases</h3>{cal.moons.map((moon, index) => {
          const phase = moonPhase(moon, selected)
          return <div className="moon" key={index}><span aria-hidden="true">{phaseSymbols[phase]}</span><div><strong>{moon.name}</strong><small>{phaseNames[phase]}</small></div></div>
        })}</section>}
        <section><h3>Events</h3>{selectedEvents.length ? selectedEvents.map(event => eventButton(event, selected)) : <p className="muted">No events on this date.</p>}</section>
      </aside>
    </main>
    {panel && <Dialog key={panel} title={dialogTitle[panel]} close={close}>
      {error && <p role="alert" className="error">{error}</p>}
      {panel === 'event' && <EventEditor calendar={cal} day={selected} event={editing} save={saveEvent} close={close}/>}
      {panel === 'calendar' && <CalendarEditor campaign={campaign} close={close} backup={backup} save={next => {
        if (saveCampaign(next)) { setSelected(next.current); setSearch(undefined); close() }
      }}/>}
      {(panel === 'jump' || panel === 'clock') && <form className="form" onSubmit={e => {
        e.preventDefault()
        if (panel === 'clock') setClock(draftDate)
        else { setSelected(draftDate); setSearch(undefined); close() }
      }}><DateField calendar={cal} label="Date" value={draftDate} onChange={setDraftDate}/><div className="actions"><button className="primary">{panel === 'clock' ? 'Set campaign date' : 'Go to date'}</button></div></form>}
      {panel === 'new' && <form className="form" onSubmit={e => {
        e.preventDefault()
        if (!campaignName.trim()) return
        const sample = preset === 'dragonlance' ? dragonlance() : undefined
        const created = newCampaign(campaignName.trim(), sample?.calendar ?? (preset === 'greyhawk' ? greyhawk() : undefined), sample?.current)
        if (commit({ ...store, active: created.id, campaigns: [...store.campaigns, created] })) { setSelected(created.current); setSearch(undefined); close() }
      }}><label>Campaign name<input autoFocus maxLength={120} required value={campaignName} onChange={e => setCampaignName(e.target.value)}/></label>
      <label>Calendar template<select value={preset} onChange={e => setPreset(e.target.value)}><option value="generic">Generic calendar</option><option value="dragonlance">Dragonlance · pre-Cataclysm example</option><option value="greyhawk">Greyhawk · festival calendar</option></select></label>
      {preset === 'dragonlance' && <p>Moon cycles come from <a href={lanceSource} target="_blank" rel="noreferrer">Tales of the Lance</a>. Replace the sample phase anchors with your campaign’s phases in Calendar settings.</p>}
      <div className="actions"><button className="primary">Create campaign</button></div></form>}
      {panel === 'data' && <div className="form"><button disabled={locked} onClick={backup}>Back up {campaign.name}</button>
        {locked && <button className="danger" onClick={() => {
          if (window.confirm('Replace unreadable browser data with a new campaign?') && commit(store, true)) close()
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
          : <>Replace the active campaign <strong>{campaign.name}</strong> with the backup of <strong>{restore.name}</strong>?</>}</p><button className="primary" onClick={() => {
          if (commit(restoreActiveCampaign(store, restore), true)) { setSelected(restore.current); setSearch(undefined); close() }
        }}>{locked ? 'Restore campaign' : 'Replace active campaign'}</button></>}
      </div>}
      {panel === 'search' && <form className="form" onSubmit={e => {
        e.preventDefault()
        if (searchTo < searchFrom) { setError('The search end must be on or after the start.'); return }
        setError(''); setSearch({ query, from: searchFrom, to: searchTo }); close()
      }}><label>Title, location, or notes<input autoFocus value={query} onChange={e => setQuery(e.target.value)}/></label>
        <DateField calendar={cal} label="From" value={searchFrom} onChange={setSearchFrom}/><DateField calendar={cal} label="Through" value={searchTo} onChange={setSearchTo}/><div className="actions"><button className="primary">Search</button></div>
      </form>}
    </Dialog>}
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
