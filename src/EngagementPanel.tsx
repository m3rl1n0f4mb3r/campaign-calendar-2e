import { lazy, Suspense, useState } from 'react'
import { useChangedDraft, useDialogDraft, useDialogLeave } from './Dialog'
import { dateLabel } from './calendar'
import { DateField } from './DateField'
import { closingDay, formatGp, type TurnMonth } from './domain'
import {
  applyConsequence, correctEngagementExpense, deleteEngagement, engagementDeleteBlocker, expenseTarget, involvesHolding, replaceConsequence, rosterStrength, saveEngagement,
  type Consequence, type Engagement, type EngagementParticipant,
} from './engagement'
import type { Campaign } from './storage'

const QuickResolutionPanel = lazy(() => import('./QuickResolutionPanel'))

export const consequenceLabels = { troops: 'Roster change', repair: 'Repair project', expense: 'One-off expense', confidence: 'Confidence review' }
export type EngagementLink =
  | { kind: 'troops'; holdingId: string; unitId: string; day: number; correction: string }
  | { kind: 'repair'; holdingId: string; projectId: string }
  | { kind: 'expense'; holdingId: string; month: TurnMonth }
  | { kind: 'confidence'; holdingId: string; id: string; day: number; title: string }

export function EngagementPanel({ campaign, revision, selected, initialId, initialHolding, save, openLink, backToHoldings, help }: {
  campaign: Campaign; revision: string | null; selected: number; initialId?: string; initialHolding?: string
  backToHoldings?: () => void; save: (campaign: Campaign) => Promise<boolean>; openLink: (link: EngagementLink, sourceId: string, sourceHolding?: string) => void; help: () => void
}) {
  const [id, setId] = useState(initialId)
  const [showArchived, setShowArchived] = useState(false)
  const [quick, setQuick] = useState(false)
  const [draft, setDraft] = useState<Engagement>()
  const [editRevision, setEditRevision] = useState(revision)
  const [proposal, setProposal] = useState<Consequence | 'new'>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { calendar, current } = campaign
  const items = campaign.engagements ?? []
  const item = items.find(entry => entry.id === id)
  const date = (day: number) => dateLabel(calendar, day)
  const holdings = campaign.holdings ?? []
  const blocker = item && engagementDeleteBlocker(campaign, item)
  const follow = (link: EngagementLink) => {
    if (item) leave(() => openLink(link, item.id, initialHolding))
  }
  const leave = useDialogLeave()
  useDialogDraft(!!draft && (item ? JSON.stringify(draft) !== JSON.stringify(item) :
    !!(draft.title || draft.notes || draft.outcome || draft.location || draft.participants.length || draft.kind !== 'battle' || draft.start !== selected || draft.holdingId !== initialHolding)))
  const defaultDay = item?.end ?? (item?.kind === 'battle' ? item.start : Math.max(item?.start ?? current, current))
  async function commit(action: () => Campaign, done?: () => void) {
    setError('')
    if ((draft || proposal) && editRevision !== revision) {
      setError('The campaign changed. Cancel this editor and reopen it to use the latest records.')
      return
    }
    setBusy(true)
    try { if (await save(action())) done?.() }
    catch (cause) { setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Enter valid engagement details, dates, and amounts.') }
    finally { setBusy(false) }
  }

  if (quick) return <Suspense fallback={<p role="status">Loading quick resolution…</p>}><QuickResolutionPanel campaign={campaign} selected={selected} engagement={item} save={save}
    back={() => setQuick(false)} openEngagement={id => { setId(id); setQuick(false) }}/></Suspense>

  return <div className="form">
    <div className="guide-context"><button type="button" onClick={help}>Help with battles and sieges</button>
      {(!item && !draft && backToHoldings) && <button type="button" onClick={backToHoldings}>Back to holdings</button>}
      {(item || draft) && <button type="button" onClick={() => leave(() => { setId(undefined); setDraft(undefined); setProposal(undefined); setError('') })}>Back to engagements</button>}</div>
    {id && !item && <p role="status">This engagement is no longer available.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {draft ? <form className="form" onSubmit={event => {
      event.preventDefault()
      void commit(() => saveEngagement(campaign, { ...draft, consequences: item?.consequences ?? [] }), () => { setId(draft.id); setDraft(undefined) })
    }}>
      <label>Engagement name<input required maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
      <label>Type<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Engagement['kind'], end: undefined })}>
        <option value="battle">Battle</option><option value="siege">Siege</option>
      </select></label>
      <DateField calendar={calendar} label={draft.kind === 'battle' ? 'Battle date' : 'Siege start'} value={draft.start} onChange={start => setDraft({ ...draft, start })}/>
      {draft.kind === 'siege' && <>
        <label className="check"><input type="checkbox" checked={draft.end !== undefined} onChange={e => setDraft({ ...draft, end: e.target.checked ? Math.max(current, draft.start) : undefined })}/> Set siege end date</label>
        {draft.end !== undefined && <DateField calendar={calendar} label="Siege end" value={draft.end} onChange={end => setDraft({ ...draft, end })}/>}
      </>}
      <label>Location<input maxLength={120} value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value })}/></label>
      <HoldingField holdings={holdings} value={draft.holdingId} change={holdingId => setDraft({ ...draft, holdingId, projectId: undefined })}/>
      {draft.holdingId && <label>Location project<select value={draft.projectId ?? ''} onChange={e => setDraft({ ...draft, projectId: e.target.value || undefined })}>
        <option value="">No project link</option>{holdings.find(holding => holding.id === draft.holdingId)?.projects?.map(project =>
          <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}
      <fieldset className="form"><legend>Participants</legend>
        {draft.participants.map(part => <ParticipantFields key={part.id} part={part} holdings={holdings} day={draft.start}
          change={value => setDraft({ ...draft, participants: draft.participants.map(person => person.id === part.id ? value : person) })}
          remove={() => setDraft({ ...draft, participants: draft.participants.filter(person => person.id !== part.id) })}/>)}
        <button type="button" onClick={() => setDraft({ ...draft, participants: [...draft.participants, { id: crypto.randomUUID(), name: '', side: '' }] })}>Add participant</button>
      </fieldset>
      <label>Outcome<textarea value={draft.outcome} onChange={e => setDraft({ ...draft, outcome: e.target.value })}/></label>
      <label>Notes<textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>
      <div className="actions"><button type="button" onClick={() => leave(() => setDraft(undefined))}>Cancel</button><button className="primary" disabled={busy}>Save engagement</button></div>
    </form> : item ? <>
      <h3>{item.title}{item.archived && ' · Archived'}</h3>
      <p>{item.kind === 'battle' ? 'Battle' : 'Siege'} · {date(item.start)}{item.kind === 'siege' && (item.end === undefined ? ' · No end date' : ` – ${date(item.end)}`)}
        {item.location && ` · ${item.location}`}</p>
      {item.holdingId && <p>Location holding: {holdings.find(holding => holding.id === item.holdingId)?.name}
        {item.projectId && ` · ${holdings.find(holding => holding.id === item.holdingId)?.projects?.find(project => project.id === item.projectId)?.name ?? 'Project unavailable'}`}</p>}
      {item.outcome && <p className="domain-notes">{item.outcome}</p>}
      {item.notes && <p className="domain-notes">{item.notes}</p>}
      {!!item.participants.length && <ul>{item.participants.map(person => <li key={person.id}>{person.side} · {person.name}
        {person.before !== undefined && ` · Before ${person.before}`}{person.after !== undefined && ` · After ${person.after}`}</li>)}</ul>}
      <button type="button" onClick={() => setQuick(true)}>Quick resolution</button>
      <button type="button" onClick={() => { setEditRevision(revision); setDraft(item); setProposal(undefined) }}>Edit engagement</button>
      <div className="button-group">
        <button type="button" disabled={busy} onClick={() => leave(() => {
          if (item.archived || window.confirm(`Archive “${item.title}”? It will be hidden from the calendar, search, print, and the active siege list. Linked records stay available.`)) {
            void commit(() => saveEngagement(campaign, { ...item, archived: !item.archived }), () => { setProposal(undefined) })
          }
        })}>{item.archived ? 'Unarchive engagement' : 'Archive engagement'}</button>
        {!blocker && <button type="button" className="danger" disabled={busy} onClick={() => leave(() => {
          if (window.confirm(`Delete “${item.title}”? This removes its calendar entries and unapplied proposals.`)) {
            void commit(() => deleteEngagement(campaign, item.id), () => { setId(undefined); setProposal(undefined) })
          }
        })}>Delete engagement</button>}
      </div>
      {blocker && <p className="muted">{blocker}</p>}
      <fieldset className="form" disabled={busy}><legend>Consequences</legend>
        {!item.consequences.length && <p>No consequences recorded.</p>}
        {item.consequences.map(effect => {
          const holding = holdings.find(entry => entry.id === effect.holdingId)
          const costId = effect.kind === 'repair' ? effect.costId : effect.id
          const receipt = costId && holding?.turns.find(turn => turn.inputs.effectIds?.includes(costId))
          const check = effect.kind === 'confidence' ? holding?.confidence?.checks.find(entry => entry.id === effect.id) : undefined
          const roster = effect.kind === 'troops' ? holding?.military?.units.find(unit => unit.id === effect.unitId) : undefined
          const applied = effect.status === 'applied' || !!check
          const expense = effect.kind === 'expense' ? holding?.engagementExpenses?.find(entry => entry.id === effect.id) : undefined
          const project = effect.kind === 'repair' ? holding?.projects?.find(entry => entry.id === effect.projectId) : undefined
          const repairCost = effect.kind === 'repair' ? project?.costs.find(entry => entry.id === effect.costId) : undefined
          const target = expense?.target ?? (holding && effect.kind === 'expense' ? expenseTarget(campaign, holding, effect.day) : undefined)
          return <section className="form domain-holding" key={effect.id}>
            <strong>{consequenceLabels[effect.kind]} · {holding?.name ?? 'Holding unavailable'} · {check || applied ? 'Applied' : effect.status === 'declined' ? 'Declined' : 'Proposed'}</strong>
            <p>{date(check?.day ?? effect.day)}
              {effect.kind === 'troops' && ` · ${roster?.name ?? 'Unit unavailable'} · ${effect.strength} troops before · ${effect.delta > 0 ? '+' : ''}${effect.delta}`}
              {effect.kind === 'repair' && ` · ${project?.name ?? effect.title} · ${project?.workDays ?? effect.workDays} workdays · ${formatGp(project?.budget ?? effect.budget)} budget`}
              {repairCost && ` · ${repairCost.title} · ${formatGp(-repairCost.amount)} · Turn closes ${date(closingDay(calendar, repairCost.target))}`}
              {effect.kind === 'expense' && ` · ${effect.title} · ${formatGp(effect.amount)} ${effect.balance}${target ? ` · Turn closes ${date(closingDay(calendar, target))}` : ''}`}
              {check && ` · ${check.change >= 0 ? '+' : ''}${check.change} lasting confidence`}</p>
            {effect.kind === 'troops' && applied && roster?.changes.filter(change => change.kind === 'correction' && change.corrects === effect.id).map(change =>
              <p key={change.id}>Roster correction · {date(change.day)} · {change.kind === 'correction' && (change.delta > 0 ? `+${change.delta}` : change.delta)}</p>)}
            {effect.kind === 'expense' && !!effect.prior?.length && <details><summary>Expense corrections</summary><ul>
              {effect.prior.map((prior, index) => <li key={index}>{date(prior.day)} · {prior.title} · {formatGp(prior.amount)} {prior.balance}</li>)}
            </ul></details>}
            {effect.kind === 'repair' && applied && !!project?.costs.length && <label>Linked repair expense
              <select value={effect.costId ?? ''} disabled={!!proposal} onChange={e => {
                const costId = e.target.value || undefined
                void commit(() => saveEngagement(campaign, replaceConsequence(item, { ...effect, costId })))
              }}><option value="">No linked expense</option>{project.costs.map(cost =>
                <option key={cost.id} value={cost.id}>{cost.title} · {formatGp(-cost.amount)}</option>)}</select>
            </label>}
            {applied && <div className="button-group">
              {effect.kind === 'troops' && roster && <button type="button" onClick={() => follow({ kind: 'troops', holdingId: effect.holdingId, unitId: effect.unitId, day: effect.day, correction: effect.id })}>Open roster correction</button>}
              {effect.kind === 'repair' && effect.projectId && <button type="button" onClick={() => follow({ kind: 'repair', holdingId: effect.holdingId, projectId: effect.projectId! })}>Open repair project</button>}
              {check && <button type="button" onClick={() => follow({ kind: 'confidence', holdingId: effect.holdingId, id: effect.id, day: check.day, title: item.title })}>Open confidence history</button>}
              {receipt && <button type="button" onClick={() => follow({ kind: 'expense', holdingId: effect.holdingId, month: receipt.month })}>Open posted receipt</button>}
              {expense && !receipt && <button type="button" onClick={() => { setEditRevision(revision); setProposal(effect) }}>Correct expense</button>}
            </div>}
            {!applied && effect.status === 'proposed' && <div className="button-group">
              <button type="button" onClick={() => { setEditRevision(revision); setProposal(effect) }}>Edit proposal</button>
              {effect.kind === 'confidence' ? <button type="button" disabled={effect.day > current} onClick={() =>
                follow({ kind: 'confidence', holdingId: effect.holdingId, id: effect.id, day: effect.day, title: item.title })}>Open confidence review</button>
                : <button type="button" className="primary" onClick={() => void commit(() => applyConsequence(campaign, item.id, effect.id))}>Approve consequence</button>}
              <button type="button" onClick={() => void commit(() => saveEngagement(campaign, replaceConsequence(item, { ...effect, status: 'declined' })))}>Decline</button>
            </div>}
          </section>
        })}
        {proposal ? <ConsequenceFields key={proposal === 'new' ? proposal : proposal.id} campaign={campaign} engagement={item} day={defaultDay}
          original={proposal === 'new' ? undefined : proposal} cancel={() => setProposal(undefined)} submit={effect => void commit(() =>
            effect.kind === 'expense' && effect.status === 'applied' ? correctEngagementExpense(campaign, item, effect)
              : saveEngagement(campaign, replaceConsequence(item, effect)), () => setProposal(undefined))}/>
          : <button type="button" disabled={!holdings.length} onClick={() => { setEditRevision(revision); setProposal('new') }}>Propose consequence</button>}
      </fieldset>
    </> : <>
      <button type="button" onClick={() => setQuick(true)}>Quick resolution</button>
      <button type="button" className="primary" onClick={() => { setEditRevision(revision); setDraft({
        id: crypto.randomUUID(), title: '', kind: 'battle', start: selected, location: '', holdingId: initialHolding, participants: [], outcome: '', notes: '', consequences: [],
      }) }}>New battle or siege</button>
      {initialHolding && <p>Showing engagements linked to {holdings.find(holding => holding.id === initialHolding)?.name ?? 'this holding'}.</p>}
      {items.some(entry => entry.archived && (!initialHolding || involvesHolding(entry, initialHolding))) &&
        <label className="check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Show archived engagements</label>}
      {items.filter(entry => (showArchived || !entry.archived) && (!initialHolding || involvesHolding(entry, initialHolding))).sort((a, b) => b.start - a.start).map(entry =>
        <button key={entry.id} type="button" onClick={() => setId(entry.id)}>{entry.title} · {date(entry.start)}{entry.archived && ' · Archived'}</button>)}
    </>}
  </div>
}

function HoldingField({ holdings, value, change, required = false }: {
  holdings: NonNullable<Campaign['holdings']>; value?: string; change: (value?: string) => void; required?: boolean
}) {
  return <label>Holding<select value={value ?? ''} required={required} onChange={e => change(e.target.value || undefined)}>
    <option value="">{required ? 'Choose a holding' : 'No holding link'}</option>
    {holdings.map(holding => <option key={holding.id} value={holding.id}>{holding.name}</option>)}
  </select></label>
}

function ParticipantFields({ part, holdings, day, change, remove }: {
  part: EngagementParticipant; holdings: NonNullable<Campaign['holdings']>; day: number
  change: (value: EngagementParticipant) => void; remove: () => void
}) {
  const holding = holdings.find(item => item.id === part.holdingId)
  return <fieldset className="form"><legend>{part.name || 'Participant'}</legend>
    <div className="form-row">
      <label>Side<input required maxLength={120} value={part.side} onChange={e => change({ ...part, side: e.target.value })}/></label>
      <label>Participant name<input required maxLength={120} value={part.name} onChange={e => change({ ...part, name: e.target.value })}/></label>
    </div>
    <HoldingField holdings={holdings} value={part.holdingId} change={holdingId => change({ ...part, holdingId, unitId: undefined })}/>
    {holding && <label>Roster unit<select value={part.unitId ?? ''} onChange={e => {
      const unit = holding.military?.units.find(item => item.id === e.target.value)
      change({ ...part, unitId: unit?.id, name: unit?.name ?? part.name, before: unit ? rosterStrength(holding, unit.id, day) : part.before })
    }}><option value="">Manual participant</option>{holding.military?.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
    <div className="form-row">
      <label>Strength before<input type="number" min="0" value={part.before ?? ''} onChange={e => change({ ...part, before: e.target.value === '' ? undefined : e.target.valueAsNumber })}/></label>
      <label>Strength after<input type="number" min="0" value={part.after ?? ''} onChange={e => change({ ...part, after: e.target.value === '' ? undefined : e.target.valueAsNumber })}/></label>
    </div>
    <button type="button" onClick={remove}>Remove participant</button>
  </fieldset>
}

function ConsequenceFields({ campaign, engagement, day, original, submit, cancel }: {
  campaign: Campaign; engagement: Engagement; day: number; original?: Consequence
  submit: (value: Consequence) => void; cancel: () => void
}) {
  const [kind, setKind] = useState<Consequence['kind']>(original?.kind ?? 'troops')
  const [holdingId, setHolding] = useState(original?.holdingId ?? engagement.holdingId)
  const [effective, setEffective] = useState(original?.day ?? day)
  const [unitId, setUnit] = useState(original?.kind === 'troops' ? original.unitId : '')
  const [delta, setDelta] = useState<number | undefined>(original?.kind === 'troops' ? original.delta : undefined)
  const [title, setTitle] = useState(original && 'title' in original ? original.title : '')
  const [amount, setAmount] = useState(original?.kind === 'expense' ? original.amount : original?.kind === 'repair' ? original.budget : undefined)
  const [workDays, setWorkDays] = useState(original?.kind === 'repair' ? original.workDays : 1)
  const [projectId, setProject] = useState(original?.kind === 'repair' ? original.projectId : undefined)
  const [costId, setCost] = useState(original?.kind === 'repair' ? original.costId : undefined)
  const [balance, setBalance] = useState<'cash' | 'noncash'>(original?.kind === 'expense' ? original.balance : 'cash')
  const { calendar } = campaign
  const holdings = campaign.holdings ?? []
  const holding = holdings.find(item => item.id === holdingId)
  const strength = rosterStrength(holding, unitId, effective)
  const project = holding?.projects?.find(item => item.id === projectId)
  const editingExpense = original?.status === 'applied'
  useChangedDraft([kind, holdingId, effective, unitId, delta, title, amount, workDays, projectId, costId, balance])
  const parsedAmount = (input: HTMLInputElement) => input.value === '' ? undefined : Math.round(input.valueAsNumber * 100)
  return <form className="form" onSubmit={event => {
    event.preventDefault()
    if (!holding) return
    const base = { id: original?.id ?? crypto.randomUUID(), holdingId: holding.id, day: effective, status: original?.status ?? 'proposed' as const }
    switch (kind) {
      case 'troops': if (strength !== undefined && delta) submit({ ...base, kind, unitId, delta, strength }); break
      case 'repair': submit({ ...base, day: project?.start ?? effective, kind, title: project?.name ?? title, budget: project?.budget ?? amount ?? 0, workDays: project?.workDays ?? workDays, projectId, costId }); break
      case 'expense': if (amount) submit({ ...base, kind, title, balance, amount }); break
      case 'confidence': submit({ ...base, kind }); break
    }
  }}>
    {editingExpense ? <p>Correct one-off expense</p> : <>
      <label>Consequence<select value={kind} onChange={e => setKind(e.target.value as Consequence['kind'])}>
        {Object.entries(consequenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <HoldingField holdings={holdings} value={holdingId} required change={value => { setHolding(value); setUnit(''); setProject(undefined); setCost(undefined) }}/>
    </>}
    <DateField calendar={calendar} label={kind === 'expense' ? 'Expense date' : 'Effective date'} value={effective} onChange={setEffective}/>
    {kind === 'troops' && <>
      <label>Roster unit<select value={unitId} required onChange={e => {
        const value = e.target.value
        setUnit(value)
        const participant = engagement.participants.find(person => person.holdingId === holdingId && person.unitId === value)
        setDelta(participant?.before !== undefined && participant.after !== undefined ? participant.after - participant.before : undefined)
      }}><option value="">Choose a unit</option>{holding?.military?.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
      {unitId && <p>{strength === undefined ? 'This unit has no active roster on the selected date.' : `Roster snapshot on this date: ${strength} troops.`}</p>}
      <label>Signed strength change<input type="number" step="1" required value={delta ?? ''}
        onChange={e => setDelta(e.target.value === '' ? undefined : e.target.valueAsNumber)}/></label>
    </>}
    {kind === 'repair' && <>
      <label>Repair project<select value={projectId ?? ''} onChange={e => { setProject(e.target.value || undefined); setCost(undefined) }}>
        <option value="">Create repair project on approval</option>{holding?.projects?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {project ? <label>Existing project expense<select value={costId ?? ''} onChange={e => setCost(e.target.value || undefined)}>
        <option value="">Link the project only</option>{project.costs.map(cost => <option key={cost.id} value={cost.id}>{cost.title} · {formatGp(-cost.amount)}</option>)}
      </select></label> : <>
        <label>Project name<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label>Required work days<input type="number" required min="1" max="10000000" value={workDays} onChange={e => setWorkDays(e.target.valueAsNumber || 0)}/></label>
        <label>Budget (gp)<input type="number" step=".01" min="0" value={amount === undefined ? '' : amount / 100} onChange={e => setAmount(parsedAmount(e.target))}/></label>
      </>}
    </>}
    {kind === 'expense' && <>
      <label>Expense description<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label>Amount (gp)<input type="number" step=".01" min=".01" required value={amount === undefined ? '' : amount / 100} onChange={e => setAmount(parsedAmount(e.target))}/></label>
      <label>Balance<select value={balance} onChange={e => setBalance(e.target.value === 'cash' ? 'cash' : 'noncash')}>
        <option value="cash">Cash</option><option value="noncash">Noncash</option>
      </select></label>
      {holding && <p>Target turn closes {dateLabel(calendar, closingDay(calendar, expenseTarget(campaign, holding, effective)))}.</p>}
    </>}
    <div className="actions"><button type="button" onClick={cancel}>Cancel</button>
      <button className="primary" disabled={kind === 'troops' && (strength === undefined || !delta)}>{editingExpense ? 'Save expense correction' : 'Save proposal'}</button></div>
  </form>
}
