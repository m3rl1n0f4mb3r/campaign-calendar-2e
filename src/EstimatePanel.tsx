import { useMemo, useState } from 'react'
import { dateLabel, type Calendar } from './calendar'
import { DateField } from './DateField'
import { applyProjectEstimate, confirmedCompletion, forecast, newProject, requiredWork, type Project, type WorkPace, type WorkRange } from './construction'
import { formatGp } from './domain'
import {
  approveEstimate, calculateEstimate, defaultCatalog, estimateSchema, factorKeys, factorOptions, moduleSchema,
  newEstimate, siteFactors, type CastleModule, type Estimate, type EstimateLine, type EstimateSnapshot,
} from './estimate'
import type { Campaign } from './storage'

type Props = { campaign: Campaign; save: (campaign: Campaign) => Promise<boolean>; help: () => void }
type EstimateResult = ReturnType<typeof calculateEstimate>

function Decimal({ label, value, change, whole = false, optional = false }: {
  label: string; value?: number; change: (value?: number) => void; whole?: boolean; optional?: boolean
}) {
  const [input, setInput] = useState(value === undefined ? '' : String(value / 100))
  // Text input preserves trailing decimal digits while editing. The model stores hundredths.
  return <label>{label}<input type="text" inputMode={whole ? 'numeric' : 'decimal'} value={input}
    placeholder={optional ? 'Optional' : undefined} onChange={e => {
      const next = e.target.value
      if (!(whole ? /^\d*$/ : /^\d*(\.\d{0,2})?$/).test(next)) return
      const [integer, fraction = ''] = next.split('.')
      const number = next === '' || next === '.' ? undefined : Number(BigInt((integer || '0') + fraction.padEnd(2, '0')))
      if (number !== undefined && !Number.isSafeInteger(number)) return
      setInput(next)
      change(number)
    }}/></label>
}

function Breakdown({ result }: { result: EstimateResult }) {
  return <div className="grid-scroll"><table className="ledger">
    <thead><tr><th scope="col">Calculation</th><th scope="col">Cost (gp)</th><th scope="col">Worker-weeks</th></tr></thead>
    <tbody>
      <tr><th scope="row">Module totals</th><td>{result.base.cost}</td><td>{result.base.labor}</td></tr>
      <tr><th scope="row">After finish</th><td>{result.finished.cost}</td><td>{result.finished.labor}</td></tr>
      <tr><th scope="row">After 10% overhead</th><td>{result.overhead.cost}</td><td>{result.overhead.labor}</td></tr>
      <tr><th scope="row">After Production Modifier × {(result.appliedModifier / 100).toFixed(2)}</th>
        <td>{(result.cost / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>{result.labor.toLocaleString()}</td></tr>
    </tbody>
  </table></div>
}

export function EstimateHistory({ snapshots, calendar }: { snapshots?: EstimateSnapshot[]; calendar: Calendar }) {
  if (!snapshots?.length) return null
  return <details><summary>Approved estimate history ({snapshots.length})</summary>
    {[...snapshots].reverse().map(snapshot => <details key={snapshot.id} className="domain-holding">
      <summary>{snapshot.estimate.name} · {dateLabel(calendar, snapshot.approvedAt)} · {formatGp(snapshot.budget)}</summary>
      <p>{snapshot.workDays} work days at {snapshot.workWeek} work days per week.</p>
      {snapshot.estimate.assumptions && <p className="domain-notes">{snapshot.estimate.assumptions}</p>}
      {snapshot.estimate.budgetReason && <p>Budget override: {snapshot.estimate.budgetReason}</p>}
      {snapshot.estimate.modifierReason && <p>Production Modifier override: {snapshot.estimate.modifierReason}</p>}
      <p>Production Modifier calculated × {(snapshot.result.calculatedModifier / 100).toFixed(2)} · applied × {(snapshot.result.appliedModifier / 100).toFixed(2)}.</p>
      <ul>{factorKeys.map(key => <li key={key}>{siteFactors[key].label} · {snapshot.estimate.factors[key] || 'Unspecified'}</li>)}</ul>
      <ul>{snapshot.estimate.lines.map(item => <li key={item.id}>
        {item.quantity / 100} × {item.description} ({item.unit}) · {formatGp(item.cost)} and {item.labor / 100} worker-weeks per unit
      </li>)}</ul>
      <Breakdown result={snapshot.result}/>
    </details>)}
  </details>
}

export function EstimatePanel({ campaign, save, help }: Props) {
  const { calendar, current } = campaign
  const [screen, setScreen] = useState<'list' | 'estimate' | 'catalog'>('list')
  const [draft, setDraft] = useState<Estimate>()
  const [moduleEdit, setModuleEdit] = useState<CastleModule>()
  const [catalogQuery, setCatalogQuery] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [holdingId, setHoldingId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [start, setStart] = useState(current)
  const [workWeek, setWorkWeek] = useState(calendar.weekdays.length)
  const [festivalPace, setFestivalPace] = useState<WorkPace>(0)
  const [closures, setClosures] = useState<WorkRange[]>([])
  const [confirmChange, setConfirmChange] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  const catalog = useMemo(() => campaign.castleCatalog ?? defaultCatalog(), [campaign.castleCatalog])
  const filtered = catalog.filter(item => item.name.toLowerCase().includes(catalogQuery.trim().toLowerCase()))
  const holdings = campaign.holdings ?? []
  const holding = holdings.find(item => item.id === holdingId) ?? holdings[0]
  const eligible = holding?.projects?.filter(item => item.canceled === undefined) ?? []
  const existing = eligible.find(item => item.id === projectId)
  const date = (day?: number) => day === undefined ? 'Paused' : dateLabel(calendar, day)
  const currentWorkWeek = existing?.workWeek ?? workWeek
  const idle = () => { setError(''); setNotice('') }
  const editDraft = (change: Partial<Estimate>) => {
    if (!draft) return
    setDraft({ ...draft, ...change })
    setReviewing(false)
    setConfirmChange(false)
    idle()
  }
  const selectDraft = (value: Estimate) => {
    setDraft(value); setScreen('estimate'); setModuleId(''); setCatalogQuery('')
    setProjectId(''); setStart(current); setWorkWeek(calendar.weekdays.length); setFestivalPace(0); setClosures([])
    setReviewing(false); setConfirmChange(false); idle()
  }
  async function persist(next: Campaign, message: string) {
    setBusy(true)
    idle()
    try {
      const saved = await save(next)
      if (saved) setNotice(message)
      return saved
    } finally { setBusy(false) }
  }
  const draftList = (value: Estimate) => {
    const previous = campaign.castleEstimates ?? []
    return previous.some(item => item.id === value.id)
      ? previous.map(item => item.id === value.id ? value : item) : [...previous, value]
  }
  const saveDraft = async () => {
    const parsed = estimateSchema.safeParse(draft)
    if (!parsed.success) { setError('Enter an estimate name and valid quantities, rates, and duration before saving.'); return }
    if (await persist({ ...campaign, castleEstimates: draftList(parsed.data) }, 'Draft saved.')) setDraft(parsed.data)
  }
  const addModule = () => {
    const item = catalog.find(entry => entry.id === moduleId)
    if (item && draft) editDraft({ lines: [...draft.lines, { id: crypto.randomUUID(), module: item,
      description: item.name, unit: item.unit, quantity: 100, cost: item.cost, labor: item.labor }] })
  }
  let result: EstimateResult | undefined
  if (draft) {
    try { result = calculateEstimate(draft) } catch { /* The editor shows that a calculation is unavailable. */ }
  }
  function proposedProject(value: Estimate, preview = false) {
    if (!Number.isInteger(currentWorkWeek) || currentWorkWeek < 1 || currentWorkWeek > 366) throw new Error('Enter a work-week length from 1 to 366 days.')
    if (!holding) throw new Error('Create a holding in Domain Play before applying an estimate.')
    const snapshot = approveEstimate(value, currentWorkWeek, current, preview ? 'estimate-preview' : undefined)
    if (snapshot.workDays > 10_000_000) throw new Error('The approved duration is too long for a construction project.')
    if (closures.some(closure => closure.through !== undefined && closure.through < closure.from)) {
      throw new Error('A seasonal closure must end on or after its start.')
    }
    const project = existing ?? (preview ? {
      id: 'project-preview', name: value.name, start, notes: '', workWeek, workDays: workWeek, budget: 0,
      festivalPace, stops: closures, progress: [], reviews: [], reopened: [], costs: [], festivalOverrides: [],
    } : { ...newProject(calendar, start), name: value.name, workWeek, festivalPace, stops: closures })
    return applyProjectEstimate(project, snapshot)
  }
  let proposal: Project | undefined
  let proposalError = ''
  if (draft && reviewing) {
    try { proposal = proposedProject(draft, true) }
    catch (cause) { proposalError = cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Check the estimate inputs before applying.' }
  }
  const previousCompletion = existing && confirmedCompletion(existing)
  const proposedCompletion = proposal && confirmedCompletion(proposal)
  const changesCompletion = !!existing && previousCompletion !== proposedCompletion
  const feedback = <>{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}</>

  if (screen === 'list') return <div className="form">
    <div className="button-group"><button className="primary" onClick={() => selectDraft(newEstimate())}>New estimate</button>
      <button onClick={() => { setScreen('catalog'); setCatalogQuery(''); idle() }}>Manage module catalog</button><button onClick={help}>Help estimating a castle</button></div>
    {(campaign.castleEstimates ?? []).length === 0 && <p>No saved estimates in this campaign.</p>}
    {campaign.castleEstimates?.map(item => <button key={item.id} onClick={() => selectDraft(item)}>{item.name}</button>)}
  </div>

  if (screen === 'catalog') return <fieldset className="form" disabled={busy}>
    <legend>Campaign module catalog</legend>
    <div className="button-group"><button onClick={() => { setScreen(draft ? 'estimate' : 'list'); setCatalogQuery(''); setModuleEdit(undefined); idle() }}>Back</button>
      <button onClick={() => { setModuleEdit({ id: crypto.randomUUID(), name: '', unit: '', dimensions: '', technology: 0, labor: 0, cost: 0, source: 'GM catalog' }); idle() }}>Add catalog entry</button></div>
    {feedback}
    {moduleEdit ? <div className="form">
      <CatalogFields key={moduleEdit.id} item={moduleEdit} change={setModuleEdit}/>
      <div className="actions"><button onClick={() => { setModuleEdit(undefined); idle() }}>Cancel edit</button><button className="primary" onClick={async () => {
        const parsed = moduleSchema.safeParse(moduleEdit)
        if (!parsed.success) { setError('Enter a module name and unit, with valid rates and technology level.'); return }
        const original = catalog.find(item => item.id === parsed.data.id)
        const entry = original?.source.startsWith('The Castle Guide') && JSON.stringify(original) !== JSON.stringify(parsed.data)
          ? { ...parsed.data, source: 'Campaign override of The Castle Guide, pp. 54–58' } : parsed.data
        const next = original ? catalog.map(item => item.id === entry.id ? entry : item) : [...catalog, entry]
        if (await persist({ ...campaign, castleCatalog: next }, 'Campaign catalog saved.')) setModuleEdit(undefined)
      }}>Save catalog entry</button></div>
    </div> : <>
      <label>Filter modules<input type="search" value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)}/></label>
      <p>{filtered.length} of {catalog.length} modules</p>
      {filtered.map(item => <div key={item.id} className="construction-heading">
        <span>{item.name} · {formatGp(item.cost)} · {item.labor / 100} worker-weeks</span>
        <button onClick={() => { setModuleEdit(item); idle() }}>Edit {item.name}</button>
      </div>)}
    </>}
  </fieldset>

  if (!draft) return null
  return <fieldset className="form" disabled={busy}>
    <legend>Castle estimate</legend>
    <div className="button-group">
      <button onClick={() => { setDraft(undefined); setScreen('list'); idle() }}>Back to estimates</button>
      <button onClick={() => { setScreen('catalog'); setCatalogQuery(''); idle() }}>Manage module catalog</button>
      <button onClick={help}>Help estimating a castle</button>
    </div>
    {feedback}
    <label>Estimate name<input maxLength={120} value={draft.name} onChange={e => editDraft({ name: e.target.value })}/></label>
    <fieldset className="form"><legend>Module quantities</legend>
      <label>Filter modules<input type="search" value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)}/></label>
      <label>Castle module<select value={moduleId} onChange={e => setModuleId(e.target.value)}>
        <option value="">Choose a module</option>{filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {catalog.filter(item => item.id === moduleId && filtered.includes(item)).map(item => <p key={item.id}>
        {item.unit} · {item.dimensions || 'No dimensions supplied'} · Tech {item.technology} · {formatGp(item.cost)} · {item.labor / 100} worker-weeks
      </p>)}
      <div className="button-group">
        <button disabled={!filtered.some(item => item.id === moduleId)} onClick={addModule}>Add module line</button>
        <button onClick={() => editDraft({ lines: [...draft.lines, { id: crypto.randomUUID(), description: '', unit: '', quantity: 100, cost: 0, labor: 0 }] })}>Add custom line</button>
      </div>
      {draft.lines.map(item => <EstimateLineEditor key={item.id} item={item}
        change={changed => editDraft({ lines: draft.lines.map(line => line.id === item.id ? changed : line) })}
        remove={() => editDraft({ lines: draft.lines.filter(line => line.id !== item.id) })}/>)}
    </fieldset>
    <label>Finish<select value={draft.finish} onChange={e => editDraft({ finish: e.target.value as Estimate['finish'] })}>
      <option value="standard">Standard</option><option value="ornate">Ornate (+50%)</option><option value="spartan">Spartan (−25%)</option>
    </select></label>
    <fieldset className="form"><legend>Site Production Modifier</legend>
      <div className="domain-fields">{factorKeys.map(key => <label key={key}>{siteFactors[key].label}
        <select value={draft.factors[key]} onChange={e => editDraft({ factors: { ...draft.factors, [key]: e.target.value } })}>
          {!factorOptions(key).some(([, rate]) => rate === 100) && <option value="">Unspecified (1.00)</option>}
          {factorOptions(key).map(([name, rate]) => <option value={name} key={name}>{name} ({(rate / 100).toFixed(2)})</option>)}
        </select>
      </label>)}</div>
      {result && <p>Calculated × {(result.calculatedModifier / 100).toFixed(2)} · Applied × {(result.appliedModifier / 100).toFixed(2)}</p>}
      <Decimal key={`${draft.id}:modifier`} label="Production Modifier override" optional value={draft.modifier} change={modifier => editDraft({ modifier })}/>
      {draft.modifier !== undefined && <label>Reason for modifier override<input value={draft.modifierReason} onChange={e => editDraft({ modifierReason: e.target.value })}/></label>}
    </fieldset>
    {result ? <Breakdown result={result}/> : <p className="warning">Enter valid values to calculate the estimate.</p>}
    <div className="form-row">
      <Decimal key={`${draft.id}:budget`} label="Approved budget override (gp)" optional value={draft.approvedBudget} change={approvedBudget => editDraft({ approvedBudget })}/>
      <Decimal key={`${draft.id}:duration`} label="Approved continuous work duration (weeks)" value={draft.duration} change={duration => editDraft({ duration: duration ?? 0 })}/>
    </div>
    {draft.approvedBudget !== undefined && <label>Reason for budget override<input value={draft.budgetReason} onChange={e => editDraft({ budgetReason: e.target.value })}/></label>}
    <label>Crew and productivity assumptions<textarea value={draft.assumptions} onChange={e => editDraft({ assumptions: e.target.value })}/></label>
    <div className="actions"><button onClick={() => void saveDraft()}>Save estimate draft</button>
      <button className="primary" onClick={() => { setReviewing(true); setConfirmChange(false); idle() }}>Review project handoff</button></div>
    {reviewing && <fieldset className="form"><legend>Project revision preview</legend>
      <button onClick={help}>Help applying an estimate</button>
      {!holding ? <p>Create a holding in Domain Play to apply an estimate.</p> : <>
        <label>Holding<select value={holding.id} onChange={e => { setHoldingId(e.target.value); setProjectId(''); setConfirmChange(false) }}>
          {holdings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Project<select value={existing?.id ?? ''} onChange={e => { setProjectId(e.target.value); setConfirmChange(false) }}>
          <option value="">Create a new construction project</option>
          {eligible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {!existing && <>
          <DateField calendar={calendar} value={start} onChange={setStart} label="Project start"/>
          <div className="form-row">
            <label>Work days per week<input type="number" min="1" max="366" value={workWeek} onChange={e => setWorkWeek(+e.target.value)}/></label>
            <label>Festival pace<select value={festivalPace} onChange={e => setFestivalPace(+e.target.value as WorkPace)}>
              <option value="0">No work</option><option value="1">Half days</option><option value="2">Full days</option>
            </select></label>
          </div>
          {closures.map(item => <fieldset key={item.id}><legend>Seasonal closure</legend><div className="form-row">
            <DateField calendar={calendar} value={item.from} label="Starts" onChange={from => setClosures(closures.map(range => range.id === item.id ? { ...range, from } : range))}/>
            <DateField calendar={calendar} value={item.through ?? item.from} label="Ends after" onChange={through => setClosures(closures.map(range => range.id === item.id ? { ...range, through } : range))}/>
          </div><button onClick={() => setClosures(closures.filter(range => range.id !== item.id))}>Remove closure</button></fieldset>)}
          <button onClick={() => setClosures([...closures, { id: crypto.randomUUID(), from: start, through: start, pace: 0, notes: 'Seasonal closure' }])}>Add seasonal closure</button>
        </>}
        {proposalError && <p role="alert" className="warning">{proposalError}</p>}
        {proposal && <>
          <p>Budget {existing && `${formatGp(existing.budget)} → `}{formatGp(proposal.budget)}</p>
          <p>Project work week: {proposal.workWeek} days.</p>
          <p>Total work days {existing && `${requiredWork(existing) / 2} → `}{requiredWork(proposal) / 2}. Remaining {Math.max(0, requiredWork(proposal) - proposal.progress.reduce((sum, item) => sum + item.pace, 0)) / 2}.</p>
          {existing && <p>Current {previousCompletion === undefined ? 'forecast' : 'completion'}: {date(forecast(calendar, existing))}.</p>}
          <p>Proposed {proposedCompletion === undefined ? 'forecast' : 'completion'}: {date(forecast(calendar, proposal))}.</p>
          {changesCompletion && <label className="check"><input type="checkbox" checked={confirmChange} onChange={e => setConfirmChange(e.target.checked)}/>
            {previousCompletion !== undefined && proposedCompletion === undefined ? 'Confirm reopening the completed project' : 'Confirm the revised completion date'}
          </label>}
          <button className="primary" disabled={changesCompletion && !confirmChange} onClick={async () => {
            const updated = proposedProject(draft)
            const projects = existing ? (holding.projects ?? []).map(item => item.id === updated.id ? updated : item) : [...(holding.projects ?? []), updated]
            if (await persist({ ...campaign, castleEstimates: draftList(draft),
              holdings: holdings.map(item => item.id === holding.id ? { ...item, projects } : item) },
            existing ? 'Estimate revision applied.' : 'Construction project created.')) {
              setReviewing(false)
              setProjectId(updated.id)
              setConfirmChange(false)
            }
          }}>{existing ? 'Apply estimate revision' : 'Create construction project'}</button>
        </>}
        <EstimateHistory snapshots={existing?.estimates} calendar={calendar}/>
      </>}
    </fieldset>}
  </fieldset>
}

function CatalogFields({ item, change }: { item: CastleModule; change: (item: CastleModule) => void }) {
  const edit = (patch: Partial<CastleModule>) => change({ ...item, ...patch })
  return <>
    <label>Module name<input maxLength={120} value={item.name} onChange={e => edit({ name: e.target.value })}/></label>
    <div className="form-row">
      <label>Unit<input maxLength={120} value={item.unit} onChange={e => edit({ unit: e.target.value })}/></label>
      <label>Dimensions<input maxLength={240} value={item.dimensions} onChange={e => edit({ dimensions: e.target.value })}/></label>
    </div>
    <div className="domain-fields">
      <label>Technology level<input type="number" min="0" max="99" value={item.technology} onChange={e => edit({ technology: +e.target.value })}/></label>
      <Decimal label="Unit cost (gp)" value={item.cost} change={cost => edit({ cost: cost ?? 0 })}/>
      <Decimal label="Unit labor (worker-weeks)" value={item.labor} change={labor => edit({ labor: labor ?? 0 })}/>
    </div>
    {item.source && <p className="muted">{item.source}</p>}
  </>
}

function EstimateLineEditor({ item, change, remove }: { item: EstimateLine; change: (line: EstimateLine) => void; remove: () => void }) {
  const edit = (patch: Partial<EstimateLine>) => change({ ...item, ...patch })
  return <section className="form domain-holding">
    <label>Line description<input maxLength={120} value={item.description} onChange={e => edit({ description: e.target.value })}/></label>
    <Decimal label="Quantity" whole={!!item.module} value={item.quantity} change={quantity => edit({ quantity: quantity ?? 0 })}/>
    {item.module ? <p>{item.module.name} · {item.unit} · {item.module.dimensions} · Tech {item.module.technology} · {formatGp(item.cost)} and {item.labor / 100} worker-weeks per unit · {item.module.source}</p>
      : <div className="domain-fields">
        <label>Custom unit<input maxLength={120} value={item.unit} onChange={e => edit({ unit: e.target.value })}/></label>
        <Decimal label="Unit cost (gp)" value={item.cost} change={cost => edit({ cost: cost ?? 0 })}/>
        <Decimal label="Unit labor (worker-weeks)" value={item.labor} change={labor => edit({ labor: labor ?? 0 })}/>
      </div>}
    <button onClick={remove}>Remove line</button>
  </section>
}
