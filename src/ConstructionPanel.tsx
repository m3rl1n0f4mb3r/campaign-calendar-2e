import { useState } from 'react'
import { dateLabel, dateParts, type Calendar } from './calendar'
import { DateField } from './DateField'
import { rollDie } from './confidence'
import { closingDay, dueMonth, formatGp, monthAt, sameMonth, type Holding, type TurnMonth } from './domain'
import {
  confirmedCompletion, constructionOutcome, forecast, newProject, pendingReview, periodSpan, postWork, projectSchema,
  recordProjectReview, reopenProjectReview, requiredWork, sameProjectMonth, workCandidates, type Project, type ProjectReview, type WorkPace,
} from './construction'

type Props = {
  calendar: Calendar; clock: number; holding: Holding; projects: Project[]; change: (projects: Project[]) => void
  month?: TurnMonth; selectedProject?: string; help: () => void; backup: () => void; openReceipt?: (month: TurnMonth) => void
}

const workDays = (units: number) => `${units / 2} work days`
const paceOptions = <><option value="0">No work</option><option value="1">Half days</option><option value="2">Full days</option></>

export function ConstructionPanel({ calendar, clock, holding, projects, change, month, selectedProject, help, backup, openReceipt }: Props) {
  const [settings, setSettings] = useState<Project>()
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | undefined>(selectedProject)
  const span = month ? periodSpan(calendar, month) : undefined
  const displayed = projects.filter(project => !span || project.progress.some(item => item.day >= span.from && item.day <= span.through) ||
    project.reviews.some(item => sameMonth(item.month, month!)) ||
    (project.start <= span.through && (confirmedCompletion(project) ?? forecast(calendar, project) ?? Infinity) >= span.from &&
      (project.canceled === undefined || project.canceled >= span.from)) ||
    project.costs.some(cost => sameMonth(cost.target, month!)))
  const update = (next: Project) => {
    change(projects.some(project => project.id === next.id) ? projects.map(project => project.id === next.id ? next : project) : [...projects, next])
  }
  return <fieldset className="form"><legend>Construction</legend>
    <div className="button-group">
      <button type="button" onClick={help}>Help with construction</button>
      {!month && <button type="button" onClick={() => { setError(''); setSettings(newProject(calendar, clock)) }}>Add project</button>}
    </div>
    {settings && <ProjectSettings calendar={calendar} project={settings} change={setSettings} cancel={() => setSettings(undefined)}
      finish={() => {
        const parsed = projectSchema.safeParse(settings)
        if (!parsed.success || (settings.target !== undefined && settings.target < settings.start)) {
          setError('Enter a project name, valid budget and work length, and a target on or after the start.')
          return
        }
        update(parsed.data)
        setExpanded(settings.id)
        setSettings(undefined)
        setError('')
      }}/>}
    {error && <p role="alert" className="error">{error}</p>}
    {!displayed.length && <p>{month ? 'No construction for this turn.' : 'No construction projects.'}</p>}
    {displayed.map(project => <section className="form domain-holding" key={project.id}>
      <div className="construction-heading"><h4>{project.name}</h4><div className="button-group">
        {!month && <button type="button" onClick={() => { setError(''); setSettings(project) }}>Edit project</button>}
        <button type="button" aria-expanded={expanded === project.id} onClick={() => setExpanded(expanded === project.id ? undefined : project.id)}>
          {expanded === project.id ? 'Hide details' : 'Review project'}
        </button>
      </div></div>
      <ProjectSummary calendar={calendar} clock={clock} holding={holding} project={project}/>
      {expanded === project.id && <ProjectWork calendar={calendar} clock={clock} holding={holding} project={project}
        month={month} update={update} backup={backup} openReceipt={openReceipt}/>}
    </section>)}
  </fieldset>
}

function ProjectSettings({ calendar, project, change, cancel, finish }: {
  calendar: Calendar; project: Project; change: (project: Project) => void; cancel: () => void; finish: () => void
}) {
  const edit = (patch: Partial<Project>) => change({ ...project, ...patch })
  const locked = project.workWeekLocked || project.progress.length > 0
  return <fieldset className="form"><legend>Project settings</legend>
    <label>Project name<input maxLength={120} value={project.name} onChange={e => edit({ name: e.target.value })}/></label>
    {locked || project.reviews.length > 0 || project.reopened.length > 0
      ? <p>Project start: {dateLabel(calendar, project.start)}</p>
      : <DateField calendar={calendar} label="Project start" value={project.start} onChange={start => edit({ start })}/>}
    <div className="domain-fields">
      <label>Budget (gp)<input type="number" min="0" step=".01" value={project.budget / 100}
        onChange={e => edit({ budget: Math.round(Number(e.target.value) * 100) })}/></label>
      <label>Work days per week<input type="number" min="1" max="366" step="1" disabled={locked}
        value={project.workWeek} onChange={e => {
          const workWeek = Number(e.target.value)
          if (workWeek > 0) edit({ workWeek, workDays: project.workDays / project.workWeek * workWeek })
        }}/></label>
      <label>Required work weeks<input type="number" min="1" step="1" disabled={locked} value={project.workDays / project.workWeek}
        onChange={e => edit({ workDays: Number(e.target.value) * project.workWeek })}/></label>
    </div>
    <label>Festival pace<select value={project.festivalPace} onChange={e => edit({ festivalPace: Number(e.target.value) as WorkPace })}>{paceOptions}</select></label>
    <label className="check"><input type="checkbox" checked={project.target !== undefined}
      onChange={e => edit({ target: e.target.checked ? project.start : undefined })}/> Set a completion target</label>
    {project.target !== undefined && <DateField calendar={calendar} label="Completion target" value={project.target} onChange={target => edit({ target })}/>}
    <label>Notes<textarea value={project.notes} onChange={e => edit({ notes: e.target.value })}/></label>
    <div className="actions"><button type="button" onClick={cancel}>Cancel settings</button><button type="button" onClick={finish}>Apply project settings</button></div>
  </fieldset>
}

function ProjectSummary({ calendar, clock, holding, project }: { calendar: Calendar; clock: number; holding: Holding; project: Project }) {
  const complete = confirmedCompletion(project)
  const projected = forecast(calendar, project)
  const posted = holding.turns.flatMap(turn => turn.lines).filter(line => project.costs.some(cost => cost.id === line.effectId))
    .reduce((sum, line) => sum - line.amount, 0)
  const proposed = project.costs.filter(cost => !holding.turns.some(turn => turn.inputs.effectIds?.includes(cost.id)))
    .reduce((sum, cost) => sum - cost.amount, 0)
  const date = (day: number) => dateLabel(calendar, day)
  return <>
    <p>Start {date(project.start)} · Approved {workDays(project.progress.reduce((sum, item) => sum + item.pace, 0))} of {workDays(requiredWork(project))}</p>
    {project.canceled !== undefined ? <p>Canceled {date(project.canceled)}</p> : complete !== undefined ? <p>Completed {date(complete)}</p>
      : <p>{projected === undefined ? 'Forecast paused' : `Forecast ${date(projected)}${projected <= clock ? ' · awaiting progress review' : ''}`}
        {project.target !== undefined && project.target !== projected && ` · Target ${date(project.target)}`}</p>}
    <p>Budget {formatGp(project.budget)} · Posted {formatGp(posted)} · Proposed {formatGp(proposed)}</p>
    {project.notes && <p className="domain-notes">{project.notes}</p>}
  </>
}

function ProjectWork({ calendar, clock, project, holding, month, update, backup, openReceipt }: {
  calendar: Calendar; clock: number; project: Project; holding: Holding; month?: TurnMonth
  update: (project: Project) => void; backup: () => void; openReceipt?: (month: TurnMonth) => void
}) {
  const [error, setError] = useState('')
  const [reopen, setReopen] = useState<ProjectReview>()
  const [correct, setCorrect] = useState<number>()
  const [mode, setMode] = useState<'festival' | 'stop'>('stop')
  const span = month ? periodSpan(calendar, month) : undefined
  const [from, setFrom] = useState(Math.max(project.start, span?.from ?? project.start))
  const [through, setThrough] = useState(Math.max(project.start, Math.min(clock, span?.through ?? clock)))
  const [workOverride, setWorkOverride] = useState<WorkPace>()
  const [rangeFrom, setRangeFrom] = useState(Math.max(project.start, span?.from ?? clock))
  const [rangeThrough, setRangeThrough] = useState(Math.max(project.start, span?.through ?? clock))
  const [rangePace, setRangePace] = useState<WorkPace>(0)
  const [openEnd, setOpenEnd] = useState(false)
  const [rangeNotes, setRangeNotes] = useState('')
  const [rangeReview, setRangeReview] = useState('')
  const [costName, setCostName] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [balance, setBalance] = useState<'cash' | 'noncash'>('cash')
  const [costSource, setCostSource] = useState('')
  const next = dueMonth(calendar, holding)
  const [costDay, setCostDay] = useState(closingDay(calendar, month ?? next))
  const target = monthAt(calendar, costDay)
  const closed = closingDay(calendar, target) < closingDay(calendar, next)
  const end = confirmedCompletion(project)
  const active = project.canceled === undefined && end === undefined
  const due = pendingReview(calendar, project, Math.min(clock, span?.through ?? clock))
  const dueInView = due && (!month || sameMonth(due.month, month))
  const date = (day: number) => dateLabel(calendar, day)
  const dayInView = (day: number) => !span || (span.from <= day && day <= span.through)
  const reviews = project.reviews.filter(review => !month || sameMonth(review.month, month))
  const linked = holding.turns.filter(turn => turn.inputs.effectIds?.some(id => project.costs.some(cost => cost.id === id)))
  const post = (action: () => Project) => {
    setError('')
    try { update(projectSchema.parse(action())); return true }
    catch (cause) { setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Check the dates and amounts before applying changes.') }
  }
  const progressStart = Math.max(project.start, span?.from ?? from)
  const progressEnd = Math.min(clock, span?.through ?? through)
  const credited = new Set(project.progress.map(item => item.day))
  const remaining = Math.max(0, requiredWork(project) - project.progress.reduce((sum, item) => sum + item.pace, 0))
  let pending = 0
  if (active && remaining && workOverride !== 0) {
    for (const { day, pace } of workCandidates(calendar, project, Math.max(progressStart, from), Math.min(progressEnd, through), workOverride)) {
      if (!credited.has(day)) pending += pace
      if (pending >= remaining) break
    }
  }

  return <div className="form">
    {error && <p className="error" role="alert">{error}</p>}
    {dueInView && <ReviewEditor key={`${due.month.year}:${due.month.period}`} calendar={calendar} clock={clock} project={project} due={due}
      save={(review, weatherStop) => post(() => recordProjectReview(calendar, project, clock, review, weatherStop))}/>}
    {due && !dueInView && <p className="warning">An earlier construction review is due on {date(due.day)}. Open the project outside this turn to record it first.</p>}
    {!!reviews.length && <details><summary>Construction review history</summary><ul>
      {reviews.map(review => <li key={review.id}>{date(periodSpan(calendar, review.month).from)} · {review.roll === undefined ? 'Skipped' : `${review.roll} · ${constructionOutcome(review.roll).title}`}
        {review.extraDays && ` · ${review.extraDays} extra work days`}{review.notes && ` · ${review.notes}`}
        {!month && <button type="button" onClick={() => setReopen(review)}>Reopen review</button>}</li>)}
    </ul></details>}
    {reopen && <div className="form warning">
      <p>Reopen project reviews starting {date(periodSpan(calendar, reopen.month).from)}?</p>
      <ul>
        {project.reviews.filter(item => periodSpan(calendar, item.month).from >= periodSpan(calendar, reopen.month).from).map(item =>
          <li key={item.id}>{date(periodSpan(calendar, item.month).from)} · {item.roll === undefined ? 'Skipped' : constructionOutcome(item.roll).title}
            {item.extraDays && ` · remove ${item.extraDays} added work days`}
            {project.stops.some(stop => stop.reviewId === item.id) && ' · remove linked work stoppage'}</li>)}
        {project.progress.filter(item => item.day >= periodSpan(calendar, reopen.month).from).map(item => <li key={item.day}>{date(item.day)} · reopen {workDays(item.pace)}</li>)}
      </ul>
      <p>Posted costs stay on their ledger receipts.</p>
      {linked.map(turn => <button type="button" key={closingDay(calendar, turn.month)} onClick={() => openReceipt?.(turn.month)}>
        View receipt for {date(closingDay(calendar, turn.month))}
      </button>)}
      <div className="button-group"><button type="button" onClick={() => setReopen(undefined)}>Cancel reopen</button>
        <button type="button" onClick={backup}>Download backup</button><button type="button" className="danger" onClick={() => {
          post(() => reopenProjectReview(calendar, project, reopen.month)); setReopen(undefined)
        }}>Reopen construction records</button></div>
    </div>}
    {active && <fieldset className="form"><legend>Approve progress</legend>
      <div className="form-row"><DateField calendar={calendar} label="First work date" value={from} onChange={setFrom}/>
        <DateField calendar={calendar} label="Last work date" value={through} onChange={setThrough}/></div>
      <label>Actual pace<select value={workOverride ?? ''} onChange={e => setWorkOverride(e.target.value === '' ? undefined : Number(e.target.value) as WorkPace)}>
        <option value="">Scheduled pace</option>{paceOptions}
      </select></label>
      <p>Pending in this range: {workDays(Math.min(pending, remaining))} through the campaign date.</p>
      <button type="button" onClick={() => post(() => {
        if (span && (from < span.from || through > span.through)) throw Error('Choose dates in the current turn month.')
        return postWork(calendar, project, clock, from, through, workOverride)
      })}>Approve selected work</button>
    </fieldset>}
    {project.progress.some(item => dayInView(item.day)) && <details><summary>Approved work history</summary><ul>
      {project.progress.filter(item => dayInView(item.day)).map(item =>
        <li key={item.day}>{date(item.day)} · {workDays(item.pace)} {!month && <button type="button" onClick={() => setCorrect(item.day)}>Correct work</button>}</li>)}
    </ul></details>}
    {correct !== undefined && <div className="form warning"><p>Reopen the approved work on {date(correct)} for replacement?</p>
      <div className="button-group"><button type="button" onClick={() => setCorrect(undefined)}>Cancel correction</button>
        <button type="button" onClick={() => {
          const workDay = correct
          post(() => ({ ...project, progress: project.progress.filter(item => item.day !== workDay) }))
          setFrom(workDay); setThrough(workDay); setCorrect(undefined)
        }}>Reopen approved day</button>
      </div>
    </div>}
    {active && <fieldset className="form"><legend>Work schedule adjustments</legend>
      <label>Adjustment type<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
        <option value="stop">Stoppage or reduced speed</option><option value="festival">Festival override</option>
      </select></label>
      <div className="form-row"><DateField calendar={calendar} label="Starts" value={rangeFrom} onChange={setRangeFrom}/>
        {(!openEnd || mode === 'festival') && <DateField calendar={calendar} label="Ends after" value={rangeThrough} onChange={setRangeThrough}/>}</div>
      {mode === 'stop' && <label className="check"><input type="checkbox" checked={openEnd} onChange={e => setOpenEnd(e.target.checked)}/> No end date yet</label>}
      <label>Pace<select value={rangePace} onChange={e => setRangePace(Number(e.target.value) as WorkPace)}>{paceOptions}</select></label>
      <label>Reason<input value={rangeNotes} onChange={e => setRangeNotes(e.target.value)}/></label>
      {!!reviews.length && mode === 'stop' && <label>Related review<select value={rangeReview} onChange={e => setRangeReview(e.target.value)}>
        <option value="">Project schedule</option>
        {reviews.map(review => <option key={review.id} value={review.id}>{date(periodSpan(calendar, review.month).from)}</option>)}
      </select></label>}
      <button type="button" onClick={() => post(() => {
        const through = mode === 'stop' && openEnd ? undefined : rangeThrough
        if (through !== undefined && through < rangeFrom) throw Error('The schedule adjustment must end on or after its start.')
        const key = mode === 'stop' ? 'stops' : 'festivalOverrides'
        const reviewId = mode === 'stop' && reviews.some(review => review.id === rangeReview) ? rangeReview : undefined
        return { ...project, [key]: [...project[key], { id: crypto.randomUUID(), from: rangeFrom, through, pace: rangePace, notes: rangeNotes, reviewId }] }
      })}>Add schedule adjustment</button>
    </fieldset>}
    {[...project.stops, ...project.festivalOverrides].length > 0 && <details><summary>Schedule adjustments</summary><ul>
      {(['stops', 'festivalOverrides'] as const).flatMap(key => project[key].map(range => <li key={range.id}>
        {key === 'stops' ? 'Stoppage' : 'Festival override'} · {date(range.from)} – {range.through === undefined ? 'Open-ended' : date(range.through)}
        {' · '}{range.pace / 2} work days per day {range.notes && ` · ${range.notes}`}
        {range.through === undefined && !range.reviewId && active && <button type="button" onClick={() => post(() => {
          if (clock < range.from) throw Error('Move the campaign date to the last day of the stoppage first.')
          return { ...project, [key]: project[key].map(item => item.id === range.id ? { ...item, through: clock } : item) }
        })}>End adjustment on campaign date</button>}
        {!range.reviewId && active && <button type="button" onClick={() => post(() => ({ ...project, [key]: project[key].filter(item => item.id !== range.id) }))}>Remove adjustment</button>}
      </li>))}
    </ul></details>}
    <fieldset className="form"><legend>Project cost</legend>
      <label>Expense description<input maxLength={120} value={costName} onChange={e => setCostName(e.target.value)}/></label>
      <div className="form-row">
        <label>Cost (gp)<input type="number" min=".01" step=".01" value={costAmount} onChange={e => setCostAmount(e.target.value)}/></label>
        <label>Balance<select value={balance} onChange={e => setBalance(e.target.value as typeof balance)}>
          <option value="cash">Cash</option><option value="noncash">Noncash</option>
        </select></label>
      </div>
      {!!reviews.length && <label>Cost source<select value={costSource} onChange={e => setCostSource(e.target.value)}>
        <option value="">Construction project</option>
        {reviews.map(review => <option key={review.id} value={review.id}>{date(periodSpan(calendar, review.month).from)} · {review.roll === undefined ? 'Skipped review' : constructionOutcome(review.roll).title}</option>)}
      </select></label>}
      {!month && <DateField calendar={calendar} label="Target turn month" value={costDay} onChange={setCostDay}/>}
      <p>Target turn closes {date(closingDay(calendar, target))}.</p>
      {closed && !month && <button type="button" onClick={() => setCostDay(closingDay(calendar, next))}>Use next unresolved turn</button>}
      {closed && openReceipt && holding.turns.some(turn => sameMonth(turn.month, target)) && <button type="button" onClick={() => openReceipt(target)}>Open original turn receipt</button>}
      <button type="button" disabled={closed} onClick={() => {
        const source = reviews.some(review => review.id === costSource) ? costSource : project.id
        if (post(() => ({
          ...project, costs: [...project.costs, { id: crypto.randomUUID(), source, title: costName,
            target, category: 'general', balance, amount: -Math.round(Number(costAmount) * 100) }],
        }))) { setCostName(''); setCostAmount('') }
      }}>Queue construction cost</button>
      {!!project.costs.length && <ul>{project.costs.map(cost => {
        const receipt = holding.turns.find(turn => turn.inputs.effectIds?.includes(cost.id))
        const replay = holding.replay.some(turn => turn.inputs.effectIds?.includes(cost.id))
        return <li key={cost.id}>{cost.title} · {formatGp(-cost.amount)} · {date(closingDay(calendar, cost.target))} · {receipt ? 'Posted' : 'Proposed'}
          {receipt && openReceipt && <button type="button" onClick={() => openReceipt(receipt.month)}>Open receipt</button>}
          {!receipt && !replay && <button type="button" onClick={() => post(() => ({
            ...project, costs: project.costs.filter(item => item.id !== cost.id),
          }))}>Remove proposed cost</button>}
        </li>
      })}</ul>}
    </fieldset>
    {!month && active && <button type="button" className="danger" onClick={() => {
      if (window.confirm(`Cancel ${project.name}? Its history and any posted ledger receipts will remain.`)) post(() => ({ ...project, canceled: clock }))
    }}>Cancel project</button>}
  </div>
}

function ReviewEditor({ calendar, clock, project, due, save }: {
  calendar: Calendar; clock: number; project: Project; due: { month: TurnMonth; day: number }
  save: (review: ProjectReview, weatherStop: boolean) => void
}) {
  const saved = project.reopened.find(item => sameProjectMonth(item.month, due.month))
  const [roll, setRoll] = useState<number | undefined>(saved?.roll)
  const [weather, setWeather] = useState(false)
  const [notes, setNotes] = useState(saved?.notes ?? '')
  const [setback, setSetback] = useState<number[] | undefined>(saved?.setbackDice)
  const [extra, setExtra] = useState(false)
  const [manualExtra, setManualExtra] = useState(saved?.extraDays ?? 0)
  const [incident, setIncident] = useState<number | undefined>(saved?.incident)
  const valid = roll !== undefined && Number.isInteger(roll) && roll >= 1 && roll <= 100
  const outcome = valid ? constructionOutcome(roll) : undefined
  const severe = valid && roll >= 76 && roll <= 81
  const weatherRoll = valid && roll >= 66 && roll <= 81
  const manual = valid && roll > 65 && !severe
  const extraDays = severe
    ? extra && setback ? setback.reduce((sum, value) => sum + value, 0) * project.workWeek : undefined
    : manual && manualExtra > 0 ? manualExtra : undefined
  const validExtra = !manual || (Number.isInteger(manualExtra) && manualExtra >= 0 && manualExtra <= 10_000_000)
  const previewId = saved?.id ?? 'construction-review-preview'
  let revisedForecast: string | undefined
  if (valid && validExtra && (weather || extraDays)) {
    const updated = recordProjectReview(calendar, project, clock, { id: previewId, month: due.month, roll, extraDays, notes }, !!weatherRoll && weather)
    const finish = forecast(calendar, updated)
    revisedForecast = finish === undefined ? 'Paused' : dateLabel(calendar, finish)
  }
  function apply(skip: boolean) {
    save({ id: saved?.id ?? crypto.randomUUID(), month: due.month, roll: skip ? undefined : roll, notes,
      incident: skip ? undefined : incident, setbackDice: !skip && severe ? setback : undefined,
      extraDays: skip ? undefined : extraDays }, !skip && !!weatherRoll && weather)
  }
  return <fieldset className="form"><legend>Monthly construction review · {dateLabel(calendar, due.day)}</legend>
    <div className="button-group"><button type="button" onClick={() => setRoll(rollDie(100))}>Roll d100</button>
      <button type="button" onClick={() => apply(true)}>Skip review</button></div>
    <label>d100 result<input type="number" min="1" max="100" step="1" value={roll ?? ''} onChange={e => setRoll(e.target.value === '' ? undefined : +e.target.value)}/></label>
    {outcome && <p><strong>{outcome.title}</strong> · {outcome.guidance}</p>}
    {weatherRoll && <label className="check"><input type="checkbox" checked={weather} onChange={e => setWeather(e.target.checked)}/> Approve weather stoppage</label>}
    {severe && <><button type="button" onClick={() => setSetback([rollDie(4), rollDie(4)])}>Roll 2d4 setback</button>
      {setback && <label className="check"><input type="checkbox" checked={extra} onChange={e => setExtra(e.target.checked)}/>
        Approve {setback.reduce((sum, value) => sum + value, 0) * project.workWeek} extra work days (rolled {setback.join(' + ')})
      </label>}</>}
    {manual && <label>Additional work days to approve<input type="number" min="0" max="10000000" step="1" value={manualExtra}
      onChange={e => setManualExtra(Number(e.target.value))}/></label>}
    {revisedForecast && <p>Revised forecast if recorded: {revisedForecast}.</p>}
    <label className="check"><input type="checkbox" checked={incident !== undefined} onChange={e => setIncident(e.target.checked ? Math.min(clock, due.day) : undefined)}/> Add dated incident to calendar</label>
    {incident !== undefined && <DateField calendar={calendar} label="Incident date" value={incident} onChange={setIncident}/>}
    <label>Review notes<textarea value={notes} onChange={e => setNotes(e.target.value)}/></label>
    <button type="button" disabled={!valid || !validExtra} onClick={() => apply(false)}>Record construction review</button>
  </fieldset>
}
