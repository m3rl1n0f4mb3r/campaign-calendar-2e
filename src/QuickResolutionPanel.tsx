import { useState, type FormEvent } from 'react'
import { dateLabel } from './calendar'
import { useChangedDraft, useDialogLeave } from './Dialog'
import { DateField } from './DateField'
import { rollDie } from './confidence'
import type { Engagement } from './engagement'
import {
  approveResolution, defaultForce, nextResolutionAction, resolutionModifiers, resolutionState, resolutionSummary,
  resolveStep, storeResolution, type Conditions, type Force, type Resolution,
} from './quickResolution'
import type { Campaign } from './storage'

const sides = ['a', 'b'] as const
type Side = typeof sides[number]
type Props = {
  campaign: Campaign; selected: number; engagement?: Engagement; save: (campaign: Campaign) => Promise<boolean>
  help: () => void; back: () => void; openEngagement: (id: string) => void
}

export default function QuickResolutionPanel({ campaign, selected, engagement, save, back, openEngagement, help }: Props) {
  const [id, setId] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const all = campaign.resolutions ?? []
  const item = all.find(entry => entry.id === id)
  const { calendar } = campaign
  async function persist(action: () => Campaign, done?: () => void) {
    if (busy) return
    setBusy(true)
    setError('')
    try { if (await save(action())) done?.() }
    catch (cause) { setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Enter valid dates, force values, and rolls.') }
    finally { setBusy(false) }
  }
  const leave = useDialogLeave()
  const scoped = engagement ? all.filter(entry => entry.engagementId === engagement.id) : all
  return <div className="form">
    <div className="guide-context"><h3>Castle Guide quick resolution</h3><button type="button" onClick={help}>Help with quick resolution</button>
      <button type="button" onClick={() => leave(() => {
        setError('')
        if (item || creating) { setCreating(false); setId(undefined) }
        else back()
      })}>{item || creating ? 'Back to resolutions' : 'Back to battles and sieges'}</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {creating ? <Setup campaign={campaign} selected={selected} engagement={engagement} busy={busy} save={draft =>
      void persist(() => storeResolution(campaign, draft), () => { setCreating(false); setId(draft.id) })}/>
      : item ? <ResolutionEditor key={`${item.id}:${item.steps.length}`} campaign={campaign} resolution={item} busy={busy}
        run={input => void persist(() => storeResolution(campaign, resolveStep(item, input)))}
        undo={() => void persist(() => storeResolution(campaign, { ...item, steps: item.steps.slice(0, -1) }))}
        discard={() => {
          if (window.confirm(`Discard the draft “${item.title}” and its rolls?`)) {
            void persist(() => ({ ...campaign, resolutions: all.filter(entry => entry.id !== item.id) }), () => setId(undefined))
          }
        }}
        approve={(outcome, reason, target, narrative) => void persist(() => approveResolution(campaign, item, outcome, reason, target, narrative))}
        openEngagement={openEngagement}/>
        : <>
          <p>Use the chapter 8 procedures to resolve force points and morale. Each completed step is saved with the campaign.</p>
          <button type="button" className="primary" onClick={() => setCreating(true)}>New quick resolution</button>
          {!scoped.length && <p>No saved resolutions.</p>}
          {[...scoped].reverse().map(entry => <button key={entry.id} type="button" onClick={() => { setError(''); setId(entry.id) }}>
            {entry.title} · {dateLabel(calendar, entry.start)} · {entry.approval ? 'Approved' : 'Draft'}
          </button>)}
        </>}
  </div>
}

function Setup({ campaign, selected, engagement, busy, save }: {
  campaign: Campaign; selected: number; engagement?: Engagement; busy: boolean; save: (resolution: Resolution) => void
}) {
  const [kind, setKind] = useState<Resolution['kind']>(engagement?.kind ?? 'battle')
  const [title, setTitle] = useState(engagement?.title ?? '')
  const [start, setStart] = useState(engagement?.start ?? selected)
  const labels = [...new Set(engagement?.participants.map(person => person.side))]
  const [a, setA] = useState(defaultForce(labels[0] ?? (kind === 'siege' ? 'Attackers' : 'Force A')))
  const [b, setB] = useState(defaultForce(labels[1] ?? (kind === 'siege' ? 'Defenders' : 'Force B')))
  useChangedDraft([kind, title, start, a, b])
  return <form className="form" onSubmit={e => {
    e.preventDefault()
    save({ id: crypto.randomUUID(), title, kind, start, engagementId: engagement?.id, rules: 'DMGR2 chapter 8 v1', forces: { a, b }, steps: [] })
  }}>
    <label>Resolution title<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)}/></label>
    {!engagement && <>
      <label>Type<select value={kind} onChange={e => {
        const value = e.target.value === 'battle' ? 'battle' : 'siege'
        if (a.name === 'Force A' || a.name === 'Attackers') setA({ ...a, name: value === 'battle' ? 'Force A' : 'Attackers' })
        if (b.name === 'Force B' || b.name === 'Defenders') setB({ ...b, name: value === 'battle' ? 'Force B' : 'Defenders' })
        setKind(value)
      }}><option value="battle">Battle</option><option value="siege">Siege</option></select></label>
      <DateField calendar={campaign.calendar} value={start} label={kind === 'siege' ? 'Siege start' : 'Battle date'} onChange={setStart}/>
    </>}
    <ForceFields label={kind === 'siege' ? 'Attackers' : 'Force A'} kind={kind} force={a} change={setA}/>
    <ForceFields label={kind === 'siege' ? 'Defenders' : 'Force B'} kind={kind} force={b} change={setB}/>
    <button className="primary" disabled={busy}>Create draft</button>
  </form>
}

function ForceFields({ label, kind, force, change }: {
  label: string; kind: Resolution['kind']; force: Force; change: (force: Force) => void
}) {
  return <fieldset className="form"><legend>{label}</legend>
    <label>Side name<input required maxLength={120} value={force.name} onChange={e => change({ ...force, name: e.target.value })}/></label>
    <label>Starting force points<input type="number" min="1" max="100000000" required value={force.points || ''}
      onChange={e => change({ ...force, points: e.target.valueAsNumber || 0 })}/></label>
    <MoraleField value={force.morale} change={morale => change({ ...force, morale })}/>
    <ConditionFields kind={kind} defender={label === 'Defenders'} value={force} change={conditions => change({ ...force, ...conditions })}/>
  </fieldset>
}

function MoraleField({ value, change }: { value: number; change: (value: number) => void }) {
  const [scores, setScores] = useState('')
  const items = scores.split(/[\s,]+/).filter(Boolean).map(Number)
  return <>
    <label>Average morale<input type="number" step="1" min="-10000" max="10000" required value={value}
      onChange={e => change(e.target.valueAsNumber || 0)}/></label>
    <details><summary>Calculate average from unit morale</summary>
      <label>Unit morale scores, separated by commas<input value={scores} onChange={e => setScores(e.target.value)}/></label>
      <button type="button" disabled={!items.length || items.some(item => !Number.isInteger(item) || Math.abs(item) > 10000)}
        onClick={() => change(Math.round(items.reduce((sum, item) => sum + item, 0) / items.length))}>Use average</button>
    </details>
  </>
}

function ConditionFields({ kind, defender, value, change }: { kind: Resolution['kind']; defender: boolean; value: Conditions; change: (value: Conditions) => void }) {
  const siege = kind === 'siege'
  return <>
    <div className="form-row">
      <label>Commander level<input type="number" min="0" max="100" required value={value.commander}
        onChange={e => change({ ...value, commander: e.target.valueAsNumber || 0 })}/></label>
      <label>Supply conditions<select value={value.supplies} onChange={e => change({ ...value, supplies: e.target.value as Conditions['supplies'] })}>
        <option value="supplied">Supplied</option><option value="short">{siege ? defender ? 'Out of supplies, no attrition yet' : 'Out of supplies, scavenging possible' : 'Cut off from supplies'}</option>
        {siege && <option value="depleted">{defender ? 'Out of supplies, attrition underway' : 'Out of supplies, scavenging difficult'}</option>}
      </select></label>
    </div>
    {([['casters', 'Spellcasters'], ['supernatural', 'Magical or undead forces'], ['engines', siege ? 'Cannon' : 'Bombardment engines'], ['flying', 'Flying units']] as const)
      .map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={value[key]}
        onChange={e => change({ ...value, [key]: e.target.checked })}/>{label}</label>)}
  </>
}

function ResolutionEditor({ campaign, resolution, busy, run, undo, discard, approve, openEngagement }: {
  campaign: Campaign; resolution: Resolution; busy: boolean
  run: (input: Parameters<typeof resolveStep>[1]) => void; undo: () => void; discard: () => void
  approve: (outcome: string, reason: string, target?: string, narrative?: string) => void; openEngagement: (id: string) => void
}) {
  const state = resolutionState(resolution)
  const next = nextResolutionAction(resolution)
  const [day, setDay] = useState(state.day)
  const [roller, setRoller] = useState<Side>(next.actor ?? 'a')
  const [roll, setRoll] = useState('')
  const [adjustment, setAdjustment] = useState(0)
  const [editSide, setEditSide] = useState<Side>()
  const [finish, setFinish] = useState(false)
  const [winner, setWinner] = useState<'a' | 'b' | 'undecided'>('undecided')
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState(resolutionSummary(resolution))
  const [narrative, setNarrative] = useState('')
  const [reason, setReason] = useState('')
  const [link, setLink] = useState(resolution.engagementId ?? '')
  useChangedDraft([day, roller, roll, adjustment, winner, note, outcome, narrative, reason, link])
  const { calendar } = campaign
  const nameOf = (side: Side) => resolution.forces[side].name
  const dice = next.kind === 'morale' || next.kind === 'rally' ? 20 : 100
  const rollStep = (result: number) => {
    if (next.kind === 'morale' || next.kind === 'rally' || next.kind === 'round' || next.kind === 'phase') {
      run({ kind: next.kind, roll: result, day, actor: roller, adjustment })
    }
  }
  const rollForm = (e: FormEvent) => { e.preventDefault(); rollStep(Number(roll)) }
  return <fieldset className="form" disabled={busy}><legend>{resolution.title}</legend>
    <p>{resolution.kind === 'battle' ? 'Battle' : 'Siege'} · {dateLabel(calendar, resolution.start)} · {resolution.rules}</p>
    <ul>{sides.map(side => <li key={side}>{nameOf(side)} · {state.positions[side].points} / {resolution.forces[side].points} force points · Morale {state.positions[side].morale}</li>)}</ul>
    {resolution.approval ? <>
      <h4>Approved outcome</h4><p className="domain-notes">{resolution.approval.outcome}</p>
      {resolution.approval.narrative && <p className="domain-notes">{resolution.approval.narrative}</p>}
      {resolution.approval.reason && <p>Override reason · {resolution.approval.reason}</p>}
      {resolution.engagementId && <button type="button" onClick={() => openEngagement(resolution.engagementId!)}>Open engagement</button>}
    </> : <>
      {next.kind === 'finished' ? <form className="form" onSubmit={e => { e.preventDefault(); approve(outcome, reason, link || undefined, narrative) }}>
        <h4>Review outcome</h4>
        <p>{resolutionSummary(resolution)}</p>
        <p>Proposed date · {dateLabel(calendar, resolution.start)}{resolution.kind === 'siege' && state.winner !== 'undecided' && ` – ${dateLabel(calendar, state.day)}`}</p>
        <label>Save to<select value={link} onChange={e => setLink(e.target.value)}>
          <option value="">New engagement</option>{campaign.engagements?.filter(item => item.kind === resolution.kind && item.start === resolution.start)
            .map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        {link && <p className="muted">Approving replaces the linked engagement’s reported outcome. Its approved consequences stay in place.</p>}
        <label>Reported outcome<textarea required value={outcome} onChange={e => setOutcome(e.target.value)}/></label>
        {outcome.trim() !== resolutionSummary(resolution) && <label>Reason for overriding the mechanical result<textarea required value={reason} onChange={e => setReason(e.target.value)}/></label>}
        <label>Additional narrative<textarea value={narrative} onChange={e => setNarrative(e.target.value)}/></label>
        <button className="primary">Approve and save to engagement</button>
      </form> : <>
        {next.kind === 'withdrawal' && next.actor && <div className="form">
          <p>{nameOf(next.actor)} attempts to withdraw. Choose the opposing force’s response.</p>
          <div className="button-group"><button type="button" onClick={() => run({ kind: 'allow' })}>Allow withdrawal</button>
            <button type="button" onClick={() => run({ kind: 'pursue' })}>Pursue</button></div>
        </div>}
        {next.kind === 'adjudicate' && <p className="warning">{state.results.length ? state.results.join(' · ') : 'Both sides attempt to withdraw.'} Record a GM decision to finish.</p>}
        {next.kind !== 'withdrawal' && next.kind !== 'adjudicate' && <form className="form" onSubmit={rollForm}>
          <h4>{next.kind === 'phase' ? 'Resolve siege phase' : next.kind === 'round' ? 'Resolve battle turn'
            : `${next.actor ? nameOf(next.actor) : ''} · ${next.kind === 'rally' ? 'Rally check' : 'Withdrawal morale check'}`}</h4>
          {next.kind === 'phase' && <>
            <DateField calendar={calendar} value={day} label="Phase date" onChange={setDay}/>
            <p>Phase initiative · {nameOf(next.actor!)}</p>
            <label>Initiating side<select value={roller} onChange={e => setRoller(e.target.value === 'a' ? 'a' : 'b')}>
              {sides.map(side => <option key={side} value={side}>{nameOf(side)}</option>)}
            </select></label>
          </>}
          {dice === 100 && <>
            <label>GM adjustment<input type="number" step="1" min="-1000" max="1000" value={adjustment} onChange={e => setAdjustment(e.target.valueAsNumber || 0)}/></label>
            {!!resolutionModifiers(resolution, day, adjustment).length && <ul>{resolutionModifiers(resolution, day, adjustment).map(item =>
              <li key={item.label}>{item.label} {item.value > 0 ? '+' : ''}{item.value}</li>)}</ul>}
          </>}
          <div className="form-row"><label>Manual d{dice}<input type="number" required min="1" max={dice} value={roll} onChange={e => setRoll(e.target.value)}/></label>
            <div className="button-group"><button className="primary">Record roll</button><button type="button" onClick={() => rollStep(rollDie(dice))}>Roll d{dice}</button></div></div>
        </form>}
        {next.kind !== 'adjudicate' && <div className="button-group">{sides.map(side =>
          <button key={side} type="button" onClick={() => setEditSide(editSide === side ? undefined : side)}>Update {nameOf(side)} conditions</button>)}</div>}
        {editSide && <ConditionEditor key={editSide} defender={editSide === 'b'} position={state.positions[editSide]} current={state.conditions[editSide]} kind={resolution.kind}
          save={(conditions, morale) => run({ kind: 'conditions', side: editSide, conditions, morale })}/>}
        {!finish && next.kind !== 'adjudicate' && <button type="button" onClick={() => setFinish(true)}>Finish by GM decision</button>}
        {(finish || next.kind === 'adjudicate') && <form className="form" onSubmit={e => {
          e.preventDefault(); run({ kind: 'finish', winner, note })
        }}>
          <label>Outcome<select value={winner} onChange={e => setWinner(e.target.value as typeof winner)}>
            <option value="undecided">No winner or continue at the table</option>{sides.map(side =>
              <option key={side} value={side}>{nameOf(side)} prevails</option>)}
          </select></label>
          <label>Reason<textarea required value={note} onChange={e => setNote(e.target.value)}/></label>
          <button className="primary">Finish resolution</button>
        </form>}
      </>}
      <div className="button-group"><button type="button" disabled={!resolution.steps.length} onClick={undo}>Undo latest step</button>
        <button type="button" className="danger" onClick={discard}>Discard draft</button></div>
    </>}
    {!!resolution.steps.length && <details><summary>Resolution history ({resolution.steps.length})</summary>
      <ol>{resolution.steps.map((step, index) => <li key={index}>
        <strong>{step.kind} · {dateLabel(calendar, step.day)}{step.actor && ` · ${nameOf(step.actor)}`}</strong>
        {step.roll !== undefined && <p>Roll {step.roll}{step.adjusted !== undefined && ` → ${step.adjusted}`}{step.modifiers.map(modifier =>
          ` · ${modifier.label} ${modifier.value > 0 ? '+' : ''}${modifier.value}`)}</p>}
        <p>{sides.map(side => `${nameOf(side)} ${step.before[side].points} → ${step.after[side].points} points, morale ${step.before[side].morale} → ${step.after[side].morale}`).join(' · ')}</p>
        {!!step.results.length && <p>{step.results.join(' · ')}</p>}{step.note && <p>{step.note}</p>}
      </li>)}</ol>
    </details>}
  </fieldset>
}

function ConditionEditor({ current, position, kind, defender, save }: {
  current: Conditions; position: { morale: number }; kind: Resolution['kind']; defender: boolean; save: (conditions: Conditions, morale: number) => void
}) {
  const [value, setValue] = useState(current)
  const [morale, setMorale] = useState(position.morale)
  useChangedDraft([value, morale])
  return <form className="form" onSubmit={e => { e.preventDefault(); save(value, morale) }}>
    <ConditionFields kind={kind} defender={defender} value={value} change={setValue}/>
    <MoraleField value={morale} change={setMorale}/>
    <button className="primary">Save changed conditions</button>
  </form>
}
