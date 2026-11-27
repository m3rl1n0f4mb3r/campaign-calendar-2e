import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { dateIndex, dateLabel, dateParts, mod, moonColor, moonPhase, movePeriod, phaseNames, phaseSymbols, weekday, yearLabel } from './calendar'
import { changeSeries, minutes, occurrences, type EventData, type Occurrence, type Rule } from './events'
import { deleteActiveCampaign, exportCampaign, key, newCampaign, parseCampaignBackup, parseStore, restoreActiveCampaign, saveIfCurrent, type Campaign, type Store } from './storage'
import { dragonlance, greyhawk, lanceSource } from './presets'
import { DateField } from './DateField'
import { EventEditor, type Scope } from './EventEditor'
import { EstimatePanel } from './EstimatePanel'
import { UserGuide, type GuideTopic } from './UserGuide'
import { DomainPanel, type ReceiptLink } from './DomainPanel'
import { constructionEntries, dominionEntries, turnEntries } from './domain'
import { ActionMenu } from './ActionMenu'
import { CalendarEditor, structuralCalendarChange } from './CalendarEditor'
import { activeSieges, engagementEntries } from './engagement'
import { EngagementPanel, type EngagementLink } from './EngagementPanel'
import { militaryEntries } from './military'
import { PrintCalendar } from './PrintCalendar'
import type { PrintEntry } from './printing'
import { Dialog } from './Dialog'
import './style.css'

type View = 'Month' | 'Week' | 'Day' | 'Agenda'
type Panel = 'new' | 'calendar' | 'event' | 'jump' | 'clock' | 'data' | 'delete' | 'search' | 'domains' | 'estimates' | 'print' | 'engagements'
const views: View[] = ['Month', 'Week', 'Day', 'Agenda']

function initialize() {
  const campaign = newCampaign('Example Campaign')
  const fallback: Store = { version: 1, active: campaign.id, campaigns: [campaign] }
  let saved: string | null = null
  try {
    saved = localStorage.getItem(key)
    return { store: saved ? parseStore(saved) : fallback, error: '', locked: false, raw: saved }
  } catch {
    return { store: fallback, error: 'Saved data could not be read. Restore a backup, or use Campaign → Backups and data to start fresh.', locked: true, raw: saved }
  }
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
  const [saving, setSaving] = useState(false)
  const writePending = useRef(false)
  const [locked, setLocked] = useState(initial.locked)
  const [error, setError] = useState(initial.error)
  const campaign = store.campaigns.find(item => item.id === store.active)!
  const cal = campaign.calendar
  const [selected, setSelected] = useState(campaign.current)
  const [view, setView] = useState<View>('Month')
  const [panel, setPanel] = useState<Panel>()
  const [militaryEntry, setMilitaryEntry] = useState<{ holdingId: string; unitId: string; day: number; correction?: string }>()
  const [engagementSelection, setEngagementSelection] = useState<{ id?: string; holdingId?: string }>()
  const [confidenceReview, setConfidenceReview] = useState<Extract<EngagementLink, { kind: 'confidence' }>>()
  const [constructionProject, setConstructionProject] = useState<{ holdingId: string; projectId: string }>()
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
  const dialogTitle = { new: 'New campaign', calendar: 'Calendar settings', event: editing ? 'Edit event' : 'New event', jump: 'Jump to date', clock: 'Set campaign date', data: 'Campaign data', delete: 'Delete campaign', search: 'Search events', domains: 'Domain Play', estimates: 'Castle estimates', print: 'Print calendar', engagements: 'Battles and sieges' }

  function syncSaved(value: string | null) {
    setRaw(value)
    if (value === null) {
      setLocked(true)
      setError('Saved data was removed in another tab. Use Campaign → Backups and data to restore or start fresh.')
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
      setError('Saved data could not be read. Use Campaign → Backups and data to restore or start fresh.')
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
    if (writePending.current || (locked && !replace)) return false
    writePending.current = true
    setSaving(true)
    const write = () => saveIfCurrent(localStorage, raw, next)
    try {
      if (!navigator.locks && [...store.campaigns, ...next.campaigns].some(item => item.holdings?.length)) {
        setError('Domain saves require a browser with cross-tab locking on a secure connection.')
        return false
      }
      const result = navigator.locks ? await navigator.locks.request(key, write) : write()
      if (!result.saved) {
        syncSaved(result.raw)
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
    } finally { writePending.current = false; setSaving(false) }
  }

  const saveCampaign = (next: Campaign) => commit({ ...store, campaigns: store.campaigns.map(item => item.id === next.id ? next : item) })
  const close = () => { restoreRequest.current++; setPanel(undefined); setRestore(undefined) }
  function open(next: Panel) {
    setPanel(next)
    setDraftDate(next === 'clock' ? campaign.current : selected)
    if (next === 'domains') { setReceipt(undefined); setDominionEvent(undefined); setConstructionProject(undefined); setMilitaryEntry(undefined); setConfidenceReview(undefined) }
    if (next === 'new') { setCampaignName(''); setPreset('generic') }
    if (next === 'search') { setSearchFrom(selected); setSearchTo(selected + 29) }
  }
  function openEngagement(id?: string, holdingId?: string) {
    setEngagementSelection({ id, holdingId })
    open('engagements')
  }
  function openEngagementLink(link: EngagementLink) {
    open('domains')
    switch (link.kind) {
      case 'troops': setMilitaryEntry(link); break
      case 'repair': setConstructionProject(link); break
      case 'expense': setReceipt(link); break
      case 'confidence': setConfidenceReview(link); break
    }
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
  const showCalendarMoons = cal.moons.length > 0 && (cal.showMoons ?? true)
  const printRange = from + 1 === to
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
    const entries: (PrintEntry & { render: (day: number, compact?: boolean) => ReactNode })[] = events.map(event => ({
      key: `${event.series.id}:${event.original}`, start: event.start, end: event.end,
      title: event.title, kind: event.allDay ? 'all-day' : 'timed', time: timeLabel(event), location: event.location,
      render: (day: number, compact = false) => eventButton(event, day, compact),
    }))
    for (const entry of turnEntries(cal, campaign.holdings ?? [], start, end, term)) {
      const entryKey = `turn:${entry.holdingId}:${entry.month.year}:${entry.month.period}`
      entries.push({
        key: entryKey, title: entry.title, kind: 'turn', start: entry.day * minutes, end: (entry.day + 1) * minutes,
        render: (_, compact = false) => <button key={entryKey} className={compact ? 'event-chip domain-event' : 'event-item domain-event'} onClick={() => {
          setConfidenceReview(undefined)
          setMilitaryEntry(undefined)
          setConstructionProject(undefined)
          setDominionEvent(undefined)
          setReceipt(entry)
          setPanel('domains')
        }}><span>{entry.title}</span></button>,
      })
    }
    for (const entry of dominionEntries(campaign.holdings ?? [], start, end, term)) {
      const entryKey = `dominion:${entry.holdingId}:${entry.id}`
      entries.push({ key: entryKey, title: entry.title, kind: 'dominion', start: entry.day * minutes, end: (entry.day + 1) * minutes,
        render: (_, compact = false) => <button key={entryKey} className={compact ? 'event-chip domain-event' : 'event-item domain-event'} onClick={() => {
          setConfidenceReview(undefined)
          setMilitaryEntry(undefined)
          setReceipt(undefined)
          setConstructionProject(undefined)
          setDominionEvent(entry)
          setPanel('domains')
        }}><span>{entry.title}</span>{!compact && <small>Dominion event · {entry.status}</small>}</button>,
      })
    }
    for (const entry of constructionEntries(cal, campaign.holdings ?? [], start, end, term)) {
      const entryKey = `construction:${entry.holdingId}:${entry.projectId}:${entry.id}`
      entries.push({ key: entryKey, title: entry.title, kind: 'construction', start: entry.day * minutes, end: (entry.day + 1) * minutes,
        render: (_, compact = false) => <button key={entryKey} className={compact ? 'event-chip domain-event' : 'event-item domain-event'} onClick={() => {
          setConfidenceReview(undefined)
          setMilitaryEntry(undefined)
          setReceipt(undefined)
          setDominionEvent(undefined)
          setConstructionProject(entry)
          setPanel('domains')
        }}><span>{entry.title}</span></button>,
      })
    }
    for (const entry of militaryEntries(campaign.holdings ?? [], start, end, term)) {
      const key = `military:${entry.holdingId}:${entry.id}`
      entries.push({ key, title: entry.title, kind: 'military', start: entry.day * minutes, end: (entry.day + 1) * minutes,
        render: (_, compact = false) => <button key={key} className={compact ? 'event-chip domain-event' : 'event-item domain-event'} onClick={() => {
          open('domains')
          setMilitaryEntry(entry)
        }}><span>{entry.title}</span></button>,
      })
    }
    for (const entry of engagementEntries(campaign.engagements ?? [], start, end, term)) {
      const key = `engagement:${entry.key}`
      entries.push({ key, title: entry.title, kind: 'engagement', start: entry.day * minutes, end: (entry.day + 1) * minutes, location: entry.location,
        render: (_, compact = false) => <button key={key} className={compact ? 'event-chip domain-event' : 'event-item domain-event'}
          onClick={() => openEngagement(entry.engagementId)}><span>{entry.title}</span></button>,
      })
    }
    return entries.sort((a, b) => a.start - b.start)
  }
  const entries = calendarEntries(list, from, to, search?.query)
  const sieges = activeSieges(campaign.engagements ?? [], selected)
  const selectedEntries = calendarEntries(selectedEvents, selected, selected + 1)
  const moonList = (day: number) => <ul className="calendar-moons" aria-label="Moon phases">{cal.moons.map((moon, index) => {
    const phase = moonPhase(moon, day)
    const label = `${moon.name}: ${phaseNames[phase]}`
    return <li key={index}><span className={`moon-disc phase-${phase}`} style={{ color: moonColor(moon, index) }} role="img" aria-label={label} title={label}/></li>
  })}</ul>

  const moonLegend = <ul className="moon-legend" aria-label="Moons in display order">{cal.moons.map((moon, index) =>
    <li key={index}><span className="moon-disc phase-4" style={{ color: moonColor(moon, index) }} aria-hidden="true"/>{moon.name}</li>
  )}</ul>

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
      <nav className="header-actions" aria-label="Campaign tools" data-dialog-fallback>
        <ActionMenu label="Campaign">{choose => <>
          <label className="campaign-picker">Switch campaign
            <select value={store.active} onChange={event => {
              const active = event.target.value
              choose(async () => {
                if (await commit({ ...store, active })) {
                  setSelected(store.campaigns.find(item => item.id === active)!.current)
                  setSearch(undefined)
                }
              })
            }}>{store.campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>
          <button type="button" onClick={() => choose(() => open('new'))}>New campaign</button>
          <button type="button" onClick={() => choose(() => open('calendar'))}>Calendar settings</button>
          <button type="button" onClick={() => choose(() => open('print'))}>Print</button>
          <button type="button" onClick={() => choose(() => open('data'))}>Backups and data</button>
        </>}</ActionMenu>
        <ActionMenu label="Domain">{choose => <>
          <button type="button" onClick={() => choose(() => open('domains'))}>Domain Play</button>
          <button type="button" onClick={() => choose(() => openEngagement())}>Battles and sieges</button>
          <button type="button" onClick={() => choose(() => open('estimates'))}>Castle estimates</button>
        </>}</ActionMenu>
        <button onClick={() => openGuide('get-started')}>Help</button>
      </nav>
    </header>
    {error && <p role="alert" className="error global-error">{error}</p>}
    <main className="layout">
      <section className="workspace">
        <div className="heading">
          <div><p className="campaign-name">{campaign.name}</p><h1>{search ? 'Search results' : `${period.name} · ${yearLabel(cal, date.year)}`}</h1>
            {(search || view !== 'Month') && <p className="print-only">{printRange}</p>}
          </div>
          <div className="button-group calendar-actions">
            <button className="primary" onClick={() => openEvent()}>＋ New event</button>
          </div>
        </div>
        <div className="toolbar">
          {search ? <>
            <span>{search.query || 'All events'} · {dateLabel(cal, search.from)} – {dateLabel(cal, search.to)}</span>
            <button onClick={() => setSearch(undefined)}>Back to calendar</button>
          </> : <div className="button-group calendar-navigation">
            <button aria-label="Previous period" onClick={() => navigate(-1)}>‹</button>
            <button aria-label="Next period" onClick={() => navigate(1)}>›</button>
            <div className="calendar-clock" role="group" aria-label="Campaign clock">
              <button title="Go to campaign date" aria-label={`Go to campaign date, ${dateLabel(cal, campaign.current)}`}
                onClick={() => setSelected(campaign.current)}>{dateLabel(cal, campaign.current)}</button>
              <ActionMenu label="Campaign clock options" iconOnly>{choose => <>
                <button type="button" onClick={() => choose(() => open('clock'))}>Set date</button>
                <button type="button" onClick={() => choose(() => void setClock(campaign.current + 1))}>Advance one day</button>
              </>}</ActionMenu>
            </div>
            <button onClick={() => open('jump')}>Jump</button>
          </div>}
          <div className="button-group">
            {!search && <div className="button-group view-tabs" aria-label="Calendar view">{views.map(item =>
              <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>
            )}</div>}
            <button onClick={() => open('search')}>Search</button>
          </div>
        </div>
        {showCalendarMoons && <div className="print-only">{moonLegend}</div>}
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
      <aside className="details" aria-labelledby="selected-day-heading">
        <h2 id="selected-day-heading">Selected day</h2>
        <p><strong>{dateLabel(cal, selected)}</strong></p><p className="muted">{cal.weekdays[weekday(cal, selected)]}</p>
        {cal.moons.length > 0 && <section><h3>Moon phases</h3>{cal.moons.map((moon, index) => {
          const phase = moonPhase(moon, selected)
          return <div className="moon" key={index}><span aria-hidden="true" style={{ color: moonColor(moon, index) }}>{phaseSymbols[phase]}</span><div><strong>{moon.name}</strong><small>{phaseNames[phase]}</small></div></div>
        })}</section>}
        {!!sieges.length && <section><h3>Active sieges</h3>{sieges.map(item =>
          <button key={item.id} className="event-item domain-event" onClick={() => openEngagement(item.id)}>{item.title}</button>)}</section>}
        <section><h3>Events</h3>{selectedEntries.length ? selectedEntries.map(entry => entry.render(selected)) : <p className="muted">No events on this date.</p>}</section>
      </aside>
    </main>
    {panel && <Dialog key={panel} title={dialogTitle[panel]} close={close} saving={saving}
      dirty={panel === 'new' ? !!campaignName || preset !== 'generic' : panel === 'data' ? !!restore : panel === 'clock' && draftDate !== campaign.current}>
      {error && <p role="alert" className="error">{error}</p>}
      {panel === 'print' && <PrintCalendar calendar={cal} campaignName={campaign.name} current={campaign.current}
        showMoons={showCalendarMoons} moonList={moonList} moonLegend={moonLegend} close={close} viewQuery={search?.query}
        currentView={view === 'Month' && !search
          ? { from: first, to: first + period.days, title: `${period.name} · ${yearLabel(cal, date.year)}`, grid: true }
          : { from, to, title: `${search ? 'Search results' : view} · ${printRange}`, grid: weekGrid }}
        entries={(start, end, query) => calendarEntries(occurrences(cal, campaign.events, start, end, query), start, end, query)}/>}
      {panel === 'estimates' && <EstimatePanel campaign={campaign} save={saveCampaign} help={() => openGuide('estimate-construction')}/>}
      {panel === 'engagements' && <EngagementPanel campaign={campaign} revision={raw} selected={selected} initialId={engagementSelection?.id}
        initialHolding={engagementSelection?.holdingId} save={saveCampaign} openLink={openEngagementLink} help={() => openGuide('battle-siege-records')}/>}
      {panel === 'domains' && <DomainPanel campaign={campaign} revision={raw} receipt={receipt} dominionEvent={dominionEvent} constructionProject={constructionProject} militaryEntry={militaryEntry} confidenceReview={confidenceReview} openEngagements={holdingId => openEngagement(undefined, holdingId)} help={openGuide} backup={backup} save={holdings => saveCampaign({ ...campaign, holdings })}/>}
      {panel === 'event' && <EventEditor calendar={cal} day={selected} event={editing} save={saveEvent} close={close}/>}
      {panel === 'calendar' && <CalendarEditor campaign={campaign} close={close} backup={backup} save={async next => {
        if (await saveCampaign(next)) {
          if (structuralCalendarChange(cal, next.calendar)) {
            setSelected(next.current); setSearch(undefined)
          }
          close()
        }
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
