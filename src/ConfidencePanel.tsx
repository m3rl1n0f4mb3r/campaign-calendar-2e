import { useEffect, useState } from 'react'
import { dateIndex, dateLabel, dateParts, displayYear, yearLabel, type Calendar } from './calendar'
import {
  clampConfidence, confidenceBand, confidenceSchema, confidenceAt, drawEvents, effectCategories, eventOptions, initialConfidence, nextReview,
  recordCheck, recordReview, rollDie, triggerLabels, yearStart,
  type Confidence, type ConfidenceCheck, type DominionEvent, type DomainEffect, type EventOption,
} from './confidence'
import { closingDay, dueMonth, formatGp, monthAt, sameMonth, type Holding, type TurnMonth } from './domain'
import { DateField } from './DateField'

export type InitialConfidenceCheck = { id: string; day: number; title: string }

type Props = {
  calendar: Calendar; clock: number; holding: Holding; revision: string | null; selectedEvent?: string; initialCheck?: InitialConfidenceCheck
  help: () => void
  save: (holding: Holding) => Promise<boolean>; back: () => void; openReceipt: (month: TurnMonth) => void; reopen: (month: TurnMonth) => void
}

export function ConfidencePanel({ calendar, clock, holding, revision, selectedEvent, initialCheck, save, back, openReceipt, reopen, help }: Props) {
  const state = holding.confidence ?? initialConfidence()
  const start = dateIndex(calendar, { ...holding.first, day: 1 })
  const due = nextReview(calendar, start, state)
  const [baseline, setBaseline] = useState(revision)
  const [savedSignature, setSavedSignature] = useState<string>()
  const signature = holding.confidence && JSON.stringify(holding.confidence)
  useEffect(() => {
    if (savedSignature && signature === savedSignature && baseline !== revision) {
      setBaseline(revision)
      setSavedSignature(undefined)
    }
  }, [baseline, revision, savedSignature, signature])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [base, setBase] = useState(state.base)
  const [startDate, setStartDate] = useState(state.start ?? start)
  const [abilities, setAbilities] = useState(state.baseRoll?.abilities ?? Array<number>(6).fill(10))
  const [baseRoll, setBaseRoll] = useState<Confidence['baseRoll']>(state.baseRoll)
  const [editing, setEditing] = useState<DominionEvent>()
  const [trigger, setTrigger] = useState<Exclude<ConfidenceCheck['trigger'], 'annual'>>(initialCheck ? 'enemy' : 'other')
  const [eventSource, setEventSource] = useState('')
  const [checkDate, setCheckDate] = useState(initialCheck?.day ?? clock)
  const [change, setChange] = useState(0)
  const [modifier, setModifier] = useState(0)
  const [notes, setNotes] = useState(initialCheck?.title ?? '')
  const [checkOpen, setCheckOpen] = useState(!!initialCheck && !state.checks.some(item => item.id === initialCheck.id))
  const [linkedCheck, setLinkedCheck] = useState(initialCheck)
  const [options, setOptions] = useState(() => state.eventOptions ?? eventOptions())
  const [custom, setCustom] = useState<EventOption>()
  const optionsChanged = JSON.stringify(options) !== JSON.stringify(state.eventOptions ?? eventOptions())
  const rollTitle = (roll: Confidence['draws'][number]['rolls'][number]) =>
    roll.title ?? eventOptions().find(item => item.key === roll.key)?.title ?? roll.key
  const [eventYear, setEventYear] = useState(dateParts(calendar, clock).year)
  const [generation, setGeneration] = useState<{ year: number; target: number; rolls: Confidence['draws'][number]['rolls']; drafts: DominionEvent[] }>()
  const [effectSource, setEffectSource] = useState('')
  const pendingMonth = dueMonth(calendar, holding)
  const [effectDate, setEffectDate] = useState(closingDay(calendar, pendingMonth))
  const [effectCategory, setEffectCategory] = useState<DomainEffect['category']>('general')
  const [effectBalance, setEffectBalance] = useState<DomainEffect['balance']>('noncash')
  const [effectAmount, setEffectAmount] = useState('')
  const sourceCheck = state.checks.find(item => item.id === effectSource)
  const [effectTitle, setEffectTitle] = useState('')
  const stale = baseline !== revision && (!savedSignature || signature !== savedSignature)
  const sources = [...state.events.filter(event => event.status === 'resolved').map(event => ({ id: event.id, title: event.title })),
    ...state.checks.map(item => ({ id: item.id, title: `${triggerLabels[item.trigger]} · ${dateLabel(calendar, item.day)}` }))]
  const target = monthAt(calendar, effectDate)
  const closed = holding.turns.find(turn => sameMonth(turn.month, target))
  const pastTarget = closingDay(calendar, target) < closingDay(calendar, pendingMonth)
  const monthlyChanges = state.checks.filter(item => {
    return sameMonth(monthAt(calendar, item.day), monthAt(calendar, checkDate))
  })
  const monthly = monthlyChanges.reduce((sum, item) => sum + item.change, change)
  const absolute = monthlyChanges.reduce((sum, item) => sum + Math.abs(item.change), Math.abs(change))
  const exceedsGuideline = Math.abs(change) > 10 || Math.abs(monthly) > 50 || absolute > 50
  const [approveGuideline, setApproveGuideline] = useState(false)

  async function commit(next: Confidence, after?: () => void) {
    if (busy || stale) return
    setBusy(true)
    setError('')
    try {
      const validated = confidenceSchema.parse(next)
      if (await save({ ...holding, confidence: validated })) {
        setSavedSignature(JSON.stringify(validated))
        after?.()
      }
    } catch { setError('Enter valid confidence and event values before saving.') }
    finally { setBusy(false) }
  }
  function annual(skip: boolean) {
    try {
      void commit(recordReview(calendar, start, clock, state, due.year, skip, crypto.randomUUID()))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record the review.') }
  }
  function startCheck(event?: DominionEvent) {
    setLinkedCheck(undefined)
    setTrigger(event ? 'disaster' : 'other')
    setEventSource(event?.id ?? '')
    setCheckDate(event?.resolvedDay ?? clock)
    setChange(0)
    setModifier(0)
    setNotes('')
    setApproveGuideline(false)
    setCheckOpen(true)
  }
  function linked(eventId: string) {
    const sources = new Set([eventId, ...state.checks.filter(item => item.eventId === eventId).map(item => item.id)])
    const ids = new Set(state.effects.filter(effect => sources.has(effect.source)).map(effect => effect.id))
    return holding.turns.filter(turn => turn.inputs.effectIds?.some(id => ids.has(id)))
  }
  function confirmEventChange(event: DominionEvent) {
    const receipts = linked(event.id)
    return receipts.length === 0 || window.confirm(`This event is linked to recorded turns closing ${receipts.map(turn => dateLabel(calendar, closingDay(calendar, turn.month))).join(', ')}. Keep those receipts and change the event?`)
  }
  function editEvent(event: DominionEvent) {
    const before = state.events.find(item => item.id === event.id)
    if (before && !confirmEventChange(before)) return
    const events = before ? state.events.map(item => item.id === event.id ? event : item) : [...state.events, event]
    void commit({ ...state, events }, () => setEditing(undefined))
  }
  function makeEvent(title = '', date = clock, disaster = false): DominionEvent {
    return { id: crypto.randomUUID(), title, day: date, disaster, status: 'scheduled', notes: '' }
  }
  function generate(additional = false) {
    const year = additional && generation ? generation.year : eventYear
    const target = additional && generation ? generation.target : rollDie(4)
    const existing = additional ? generation?.drafts ?? [] : []
    const used = new Set(existing.map(item => item.title))
    const { rolls, selected } = drawEvents(options.filter(item => !used.has(item.title)), target - existing.length)
    const scheduled = selected.map(key => options.find(option => option.key === key)!)
    setGeneration({ year, target, rolls: [...(additional ? generation?.rolls ?? [] : []), ...rolls],
      drafts: [...existing, ...scheduled.map(item => makeEvent(item.title, dateParts(calendar, clock).year === year ? clock : yearStart(calendar, year), item.disaster))] })
  }

  function optionEditor(existing: boolean) {
    if (!custom) return null
    return <form className="form" onSubmit={e => {
      e.preventDefault()
      const title = custom.title.trim()
      if (!title) return
      const draft = { ...custom, title }
      setOptions(current => existing ? current.map(item => item.key === draft.key ? draft : item) : [...current, draft])
      setCustom(undefined)
    }}>
      <label>Event title<input required maxLength={120} value={custom.title} onChange={e => setCustom({ ...custom, title: e.target.value })}/></label>
      <label>Event group<select value={custom.group} onChange={e => setCustom({ ...custom, group: e.target.value === 'Natural' ? 'Natural' : 'Unnatural' })}>
        <option>Natural</option><option>Unnatural</option>
      </select></label>
      <label>Chance (%)<input type="number" min="0" max="100" required value={custom.chance} onChange={e => setCustom({ ...custom, chance: Number(e.target.value) })}/></label>
      <label className="check"><input type="checkbox" checked={custom.disaster} onChange={e => setCustom({ ...custom, disaster: e.target.checked })}/> Natural disaster</label>
      <label className="check"><input type="checkbox" checked={custom.enabled} onChange={e => setCustom({ ...custom, enabled: e.target.checked })}/> Enabled for annual rolls</label>
      <div className="button-group">
        <button type="button" onClick={() => setCustom(undefined)}>Cancel</button>
        <button className="primary">{existing ? 'Apply changes' : 'Add to list'}</button>
        {existing && <button type="button" className="catalog-icon danger" aria-label="Remove event from the annual list"
          title="Remove event from the annual list" onClick={() => {
            setOptions(current => current.filter(item => item.key !== custom.key))
            setCustom(undefined)
          }}><span aria-hidden="true">🗑︎</span></button>}
      </div>
    </form>
  }

  if (stale) return <div className="form">
    <p className="warning" role="alert">Campaign data changed. Open the holding again to review the latest records.</p>
    <button onClick={back}>Back to holdings</button>
  </div>
  const band = confidenceBand(state.current)
  const projected = confidenceBand(clampConfidence(clampConfidence(confidenceAt(state, checkDate) + change) + modifier))

  return <div className="form">
    <div className="guide-context"><h3>{holding.name} · Confidence and events</h3>
      <button type="button" onClick={help}>Help resolving events</button></div>
    <p><strong>{state.current} · {band.name}</strong> (base {state.base})</p>
    <p>{band.guidance}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <fieldset className="form" disabled={busy}>
      <legend>Confidence and annual reviews</legend>
      <details><summary>Base confidence settings</summary>
        <form className="form" onSubmit={e => {
          e.preventDefault()
          void commit({ ...state, base, start: startDate, baseRoll, current: confidenceAt({ ...state, base }) })
        }}>
          <label>Base score<input type="number" min="1" max="500" required value={base}
            onChange={e => { setBase(+e.target.value); setBaseRoll(undefined) }}/></label>
          {state.reviews.length === 0 && <DateField calendar={calendar} value={startDate} onChange={setStartDate} label="Holding start date"/>}
          <fieldset><legend>Ruler ability scores</legend><div className="domain-fields">
            {['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'].map((name, i) =>
              <label key={name}>{name}<input type="number" min="1" max="25" required value={abilities[i]}
                onChange={e => setAbilities(abilities.map((value, index) => i === index ? +e.target.value : value))}/></label>)}
          </div></fieldset>
          <button type="button" disabled={abilities.some(value => value < 1 || value > 25 || !Number.isInteger(value))} onClick={() => {
            const die = rollDie(100)
            setBaseRoll({ die, abilities })
            setBase(clampConfidence(die + 150 + abilities.reduce((sum, value) => sum + value, 0)))
          }}>Roll base confidence</button>
          {baseRoll && <p>d100 rolled {baseRoll.die}, plus 150 and {baseRoll.abilities.reduce((sum, value) => sum + value, 0)} ability points.</p>}
          <button className="primary">Save base confidence</button>
        </form>
      </details>
      <p>Next annual review: {dateLabel(calendar, due.day)}.</p>
      {due.day <= clock && <><p>Recording this review proposes a reset to {state.base}.</p><div className="button-group">
        <button onClick={() => annual(false)}>Record annual review</button><button onClick={() => annual(true)}>Skip year</button>
      </div></>}
      {!!state.reviews.length && <details><summary>Annual review history</summary><ul>
        {state.reviews.map(item => <li key={item.year}>{yearLabel(calendar, item.year)} · {item.skipped ? 'Skipped' : 'Reviewed'}</li>)}
      </ul></details>}
      <button onClick={() => startCheck()}>Add confidence check or adjustment</button>
      {checkOpen && <form className="form" onSubmit={e => {
        e.preventDefault()
        if ((exceedsGuideline && !approveGuideline) || checkDate > clock) return
        try {
          void commit(recordCheck(state, { id: linkedCheck?.id ?? crypto.randomUUID(), day: checkDate, trigger, eventId: eventSource || undefined,
            modifier, change, notes }), () => { setCheckOpen(false); setLinkedCheck(undefined) })
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record confidence.') }
      }}>
        <label>Trigger<select value={trigger} onChange={e => setTrigger(e.target.value as typeof trigger)}>
          {Object.entries(triggerLabels).filter(([key]) => key !== 'annual').map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></label>
        <DateField calendar={calendar} value={checkDate} onChange={setCheckDate} label="Check date"/>
        <div className="form-row">
          <label>One-check modifier<input type="number" step="1" value={modifier} onChange={e => setModifier(e.target.valueAsNumber || 0)}/></label>
          <label>Lasting change<input type="number" step="1" value={change} onChange={e => { setChange(e.target.valueAsNumber || 0); setApproveGuideline(false) }}/></label>
        </div>
        <p>{projected.name} · {projected.guidance}</p>
        <label>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)}/></label>
        {checkDate > clock && <p className="warning">The check date must be on or before the campaign date.</p>}
        {exceedsGuideline && <label className="check"><input type="checkbox" checked={approveGuideline} onChange={e => setApproveGuideline(e.target.checked)}/> Approve change beyond the monthly guidance (10 per item or 50 per month)</label>}
        <div className="button-group"><button type="button" onClick={() => setCheckOpen(false)}>Cancel</button>
          <button className="primary" disabled={checkDate > clock || (exceedsGuideline && !approveGuideline)}>Record check and lasting change</button></div>
      </form>}
      {!!state.checks.length && <details open={!!initialCheck && !checkOpen || undefined}><summary>Confidence history</summary><ul>
        {[...state.checks].reverse().map(item => <li key={item.id}>{dateLabel(calendar, item.day)} · {triggerLabels[item.trigger]} · {item.score} ({item.band})
          {item.change !== 0 && ` · lasting change ${item.change > 0 ? '+' : ''}${item.change}`}
          {item.modifier !== 0 && ` · check modifier ${item.modifier > 0 ? '+' : ''}${item.modifier}`}
          {item.notes && ` · ${item.notes}`}</li>)}
      </ul></details>}
    </fieldset>
    <fieldset className="form" disabled={busy}><legend>Dominion events</legend>
      <button onClick={() => setEditing(makeEvent())}>Schedule event</button>
      {editing && <form className="form" onSubmit={e => { e.preventDefault(); if (editing.title.trim()) editEvent(editing) }}>
        <EventFields calendar={calendar} event={editing} change={setEditing}/>
        <div className="button-group"><button type="button" onClick={() => setEditing(undefined)}>Cancel</button><button className="primary">Save event</button></div>
      </form>}
      <details><summary>Generate annual candidates</summary>
        <div className="form">
          <p>Each enabled event gets its own d100 roll. A chance of 25% qualifies on a roll of 25 or lower. If more events qualify than the d4 target, the app randomly picks which ones to offer.</p>
          {(['Natural', 'Unnatural'] as const).map(group => <details key={group}><summary>{group} event chances</summary>
            <ul className="catalog-list">
              {options.filter(item => item.group === group).map(item => {
                const isEditing = custom?.key === item.key
                return <li key={item.key}>
                  <div className="catalog-row annual-event-row">
                    <div className="catalog-description"><strong>{item.title}</strong>
                      <small>{item.chance}% · {item.enabled ? 'Enabled' : 'Disabled'}</small>
                    </div>
                    <button type="button" className="catalog-icon" aria-label={`Edit ${item.title}`} title={`Edit ${item.title}`}
                      aria-expanded={isEditing} onClick={() => setCustom(isEditing ? undefined : item)}><span aria-hidden="true">✎</span></button>
                  </div>
                  {isEditing && optionEditor(true)}
                </li>
              })}
            </ul>
          </details>)}
          <p className="muted">Save the annual list to reuse it for this holding. Removing a list entry affects future rolls.</p>
          <div className="button-group">
            <button type="button" onClick={() => setCustom({ key: crypto.randomUUID(), title: '', group: 'Natural', chance: 10, disaster: false, enabled: true })}>Add event to annual list</button>
            <button type="button" disabled={!optionsChanged || !!custom} onClick={() => void commit({ ...state, eventOptions: options })}>Save annual list</button>
          </div>
          {custom && !options.some(item => item.key === custom.key) && optionEditor(false)}
          <label>Event year<input type="number" min="-99999" max="99999" step="1" defaultValue={displayYear(calendar, eventYear)}
            onBlur={e => {
              const year = e.target.valueAsNumber
              if (Number.isInteger(year) && Math.abs(year) <= 99999 && !(calendar.skipZero && year === 0)) setEventYear(year - Number(calendar.skipZero && year > 0))
              else e.target.value = String(displayYear(calendar, eventYear))
            }}/></label>
          <button onClick={() => generate()}>Roll d4 and event chances</button>
          {generation && <form className="form" onSubmit={e => {
            e.preventDefault()
            if (generation.drafts.some(item => !item.title.trim() || dateParts(calendar, item.day).year !== generation.year)) {
              setError('Give each candidate a title and a date in the selected generation year.')
              return
            }
            void commit({ ...state, events: [...state.events, ...generation.drafts], draws: [...state.draws, {
              year: generation.year, target: generation.target, rolls: generation.rolls, selected: generation.drafts.map(item => item.id),
            }] }, () => setGeneration(undefined))
          }}>
            <p>{yearLabel(calendar, generation.year)} · d4 target {generation.target} · {generation.drafts.length} candidates to schedule</p>
            {generation.drafts.length < generation.target && <div className="button-group">
              <button type="button" onClick={() => generate(true)}>Roll for remaining candidates</button>
              <button type="button" onClick={() => setGeneration({ ...generation, drafts: [...generation.drafts, makeEvent('', yearStart(calendar, generation.year))] })}>Add manual candidate</button>
            </div>}
            {generation.drafts.map(event => <fieldset className="form" key={event.id}><legend>{event.title || 'Candidate'}</legend>
              <EventFields calendar={calendar} event={event} change={updated => setGeneration({ ...generation, drafts: generation.drafts.map(item => item.id === event.id ? updated : item) })}/>
              <button type="button" onClick={() => setGeneration({ ...generation, drafts: generation.drafts.filter(item => item.id !== event.id) })}>Decline candidate</button>
            </fieldset>)}
            <details><summary>Rolls</summary><ul>{generation.rolls.map((roll, index) => <li key={index}>{rollTitle(roll)} · {roll.result} vs {roll.chance}%</li>)}</ul></details>
            <div className="button-group"><button type="button" onClick={() => setGeneration(undefined)}>Cancel</button><button className="primary">Save annual event decisions</button></div>
          </form>}
        </div>
      </details>
      {!!state.draws.length && <details><summary>Saved event rolls</summary>
        {state.draws.map((draw, index) => <details key={index}><summary>{yearLabel(calendar, draw.year)} · target {draw.target} · {draw.selected.length} scheduled</summary>
          <ul>{draw.rolls.map((roll, i) => <li key={i}>{rollTitle(roll)} · {roll.result} vs {roll.chance}%</li>)}</ul>
        </details>)}
      </details>}
      {state.events.filter(item => item.status !== 'removed').sort((a, b) => Number(b.id === selectedEvent) - Number(a.id === selectedEvent) || a.day - b.day).map(event => {
        const isDue = event.status === 'scheduled' && event.day <= clock
        const receipts = linked(event.id)
        return <section className="form domain-holding" key={event.id}>
          <h4>{event.title}{event.disaster && ' · Disaster'}</h4>
          <p>{dateLabel(calendar, event.day)} · {isDue ? 'Due' : event.status}</p>
          {event.notes && <p className="domain-notes">{event.notes}</p>}
          {!!receipts.length && <div className="button-group"><span>Linked turns</span>{receipts.map(turn =>
            <button key={closingDay(calendar, turn.month)} onClick={() => openReceipt(turn.month)}>{dateLabel(calendar, closingDay(calendar, turn.month))}</button>
          )}</div>}
          <div className="button-group">
            <button onClick={() => setEditing(event)}>{event.status === 'scheduled' ? 'Edit or reschedule' : 'Edit'}</button>
            {isDue && <><button onClick={() => editEvent({ ...event, status: 'resolved', resolvedDay: clock })}>Resolve event</button>
              <button onClick={() => editEvent({ ...event, status: 'dismissed' })}>Dismiss</button></>}
            {event.status === 'resolved' && event.disaster && <button onClick={() => startCheck(event)}>Review confidence</button>}
            <button className="danger" onClick={() => {
              if (!receipts.length && !window.confirm(`Remove ${event.title} from the calendar?`)) return
              editEvent({ ...event, status: 'removed' })
            }}>Remove event</button>
          </div>
        </section>
      })}
    </fieldset>
    <fieldset className="form" disabled={busy}><legend>Financial effects</legend>
      <p className="muted">Assign an approved amount to a turn, then select it in that turn’s ledger preview.</p>
      {sources.length > 0 && <form className="form" onSubmit={e => {
        e.preventDefault()
        const amount = Math.round(Number(effectAmount) * 100)
        if (pastTarget || !sources.some(source => source.id === effectSource) || !effectTitle.trim() || !amount || !Number.isSafeInteger(amount)) return
        const effect = { id: crypto.randomUUID(), source: effectSource, title: effectTitle.trim(),
          target, category: effectCategory, balance: effectBalance, amount }
        void commit({ ...state, effects: [...state.effects, effect] }, () => { setEffectTitle(''); setEffectAmount('') })
      }}>
        <label>Source<select required value={effectSource} onChange={e => setEffectSource(e.target.value)}><option value="">Choose a resolved event or check</option>
          {sources.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {sourceCheck && <p className="muted">{confidenceBand(sourceCheck.score).guidance}</p>}
        <label>Ledger description<input required maxLength={120} value={effectTitle} onChange={e => setEffectTitle(e.target.value)}/></label>
        <div className="domain-fields">
          <label>Category<select value={effectCategory} onChange={e => setEffectCategory(e.target.value as DomainEffect['category'])}>
            {Object.entries(effectCategories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select></label>
          <label>Balance<select value={effectBalance} onChange={e => setEffectBalance(e.target.value as DomainEffect['balance'])}><option value="cash">Cash</option><option value="noncash">Noncash</option></select></label>
          <label>Signed amount (gp)<input type="number" step=".01" required value={effectAmount} onChange={e => setEffectAmount(e.target.value)}/></label>
        </div>
        <DateField calendar={calendar} value={effectDate} onChange={setEffectDate} label="Target turn month"/>
        <p>Chosen turn closes {dateLabel(calendar, closingDay(calendar, target))}.</p>
        {pastTarget && <div className="button-group"><button type="button" onClick={() => setEffectDate(closingDay(calendar, pendingMonth))}>Use next unresolved turn</button>
          {closed && <button type="button" onClick={() => reopen(closed.month)}>Review original turn for reopening</button>}</div>}
        <button className="primary" disabled={pastTarget}>Approve effect for turn</button>
      </form>}
      {state.effects.map(effect => {
        const posted = holding.turns.some(turn => turn.inputs.effectIds?.includes(effect.id))
        return <p key={effect.id}>{effect.title} · {formatGp(effect.amount)} · {dateLabel(calendar, closingDay(calendar, effect.target))} · {posted ? 'Posted' : 'Available in turn preview'}</p>
      })}
    </fieldset>
    <button onClick={back}>Back to holdings</button>
  </div>
}

function EventFields({ calendar, event, change }: { calendar: Calendar; event: DominionEvent; change: (event: DominionEvent) => void }) {
  return <>
    <label>Event title<input value={event.title} maxLength={120} required onChange={e => change({ ...event, title: e.target.value })}/></label>
    <DateField calendar={calendar} value={event.day} onChange={day => change({ ...event, day })} label="Event date"/>
    <label className="check"><input type="checkbox" checked={event.disaster} onChange={e => change({ ...event, disaster: e.target.checked })}/> Natural disaster</label>
    <label>Event notes<textarea value={event.notes} onChange={e => change({ ...event, notes: e.target.value })}/></label>
  </>
}
