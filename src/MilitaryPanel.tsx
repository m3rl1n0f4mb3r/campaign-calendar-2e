import { useState } from 'react'
import { dateLabel, type Calendar } from './calendar'
import { DateField } from './DateField'
import { closingDay, dueMonth, formatGp, monthAt, type Holding } from './domain'
import { militarySchema, rosterHistory, rosterLabels, validMilitary,
  type Billing, type Military, type RosterChange, type Supply, type Terms, type Unit } from './military'

type Props = {
  calendar: Calendar; clock: number; holding: Holding; military: Military; initialDay?: number; selectedUnit?: string; correction?: string
  change: (value: Military) => void; help: () => void
}
const defaultTerms: Terms = { service: 'unpaid', rateType: 'unit', rate: 0 }

export function MilitaryPanel({ calendar, clock, holding, military, initialDay, selectedUnit, correction, change, help }: Props) {
  const [day, setDay] = useState(initialDay ?? clock)
  const [edit, setEdit] = useState<'muster' | 'supply' | Unit | undefined>(() => correction ? military.units.find(unit => unit.id === selectedUnit) : undefined)
  const [error, setError] = useState('')
  const [showArchived, setShowArchived] = useState(!!selectedUnit)
  const date = (value: number) => dateLabel(calendar, value)
  function apply(value: Military) {
    try {
      const next = militarySchema.parse(value)
      if (!validMilitary(next)) throw new Error('Check the unit history and supply records.')
      change(next)
      setEdit(undefined)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Enter valid roster or supply information.')
    }
  }

  return <div className="form">
    <div className="guide-context"><h3>{holding.name} · Garrison roster</h3><button type="button" onClick={help}>Help with military expenses</button></div>
    <DateField calendar={calendar} value={day} onChange={setDay} label="Roster date"/>
    <div className="button-group">
      <button type="button" onClick={() => { setEdit('muster'); setError('') }}>Muster unit</button>
      <button type="button" onClick={() => { setEdit('supply'); setError('') }}>Propose extra supply expense</button>
    </div>
    {edit === 'muster' && <RosterEditor key="muster" calendar={calendar} from={day} cancel={() => setEdit(undefined)}
      submit={(entry, identity) => {
        if (identity && entry.kind === 'muster') apply({ ...military, units: [...military.units, { ...identity, id: crypto.randomUUID(), changes: [entry] }] })
      }}/>}
    {edit === 'supply' && <SupplyEditor calendar={calendar} from={day} units={military.units} cancel={() => setEdit(undefined)}
      submit={supply => {
        const target = Math.max(closingDay(calendar, dueMonth(calendar, holding)), closingDay(calendar, monthAt(calendar, supply.day)))
        apply({ ...military, supplies: [...military.supplies, { ...supply, target }] })
      }}/>}
    {error && <p className="error" role="alert">{error}</p>}
    {military.units.some(unit => unit.archived) && <label className="check"><input type="checkbox" checked={showArchived}
      onChange={e => setShowArchived(e.target.checked)}/> Show archived units</label>}
    {!military.units.length && <p>No units have been mustered for this holding.</p>}
    {military.units.filter(unit => showArchived || !unit.archived).map(unit => {
      const history = rosterHistory(unit)
      const asOf = history.filter(item => item.change.day <= day).at(-1)
      const state = asOf?.state
      const latest = history.at(-1)
      const isEditing = typeof edit === 'object' && edit.id === unit.id
      return <section className="form domain-holding" key={unit.id}>
        <h4>{unit.name} · {unit.type}{unit.archived && ' · Archived'}</h4>
        {state ? <p>{asOf.change.kind === 'release' ? 'Released' : `${state.strength} troops`}{state.location && ` · ${state.location}`} · {state.terms.service === 'paid'
          ? `${formatGp(state.terms.rate)} per ${state.terms.rateType} per month` : `${state.terms.service === 'unpaid' ? 'Unpaid' : 'Obligation-based'} service`}{state.billing !== 'home' && ` · ${state.billing === 'unpaid' ? 'Unpaid deployment' : 'Costs covered elsewhere'}`}</p>
          : <p>Mustered on {date(history[0].change.day)}.</p>}
        <div className="button-group">
          {!unit.archived && <button type="button" onClick={() => { setEdit(unit); setError('') }}>Record roster change</button>}
          {latest?.change.kind === 'release' && latest.change.day <= clock && <button type="button" onClick={() =>
            apply({ ...military, units: military.units.map(item => item.id === unit.id ? { ...item, archived: !unit.archived } : item) })}>
            {unit.archived ? 'Unarchive unit' : 'Archive unit'}
          </button>}
        </div>
        {isEditing && <RosterEditor key={unit.id} calendar={calendar} from={day} unit={unit} correction={correction && selectedUnit === unit.id ? correction : undefined}
          previousTerms={state?.terms} currentLocation={state?.location} cancel={() => setEdit(undefined)}
          submit={entry => apply({ ...military, units: military.units.map(item =>
            item.id === unit.id ? { ...item, changes: [...item.changes, entry] } : item) })}/>}
        <details open={selectedUnit === unit.id || undefined}><summary>Roster history</summary><ul>{history.map(({ change, state }) =>
          <li key={change.id}>{date(change.day)} · {rosterLabels[change.kind]} · {state.strength} troops
            {state.location && ` · ${state.location}`}
            {(change.kind === 'terms' || change.kind === 'muster') && state.terms.service === 'paid' && ` · ${formatGp(state.terms.rate)} per ${state.terms.rateType} per month`}
            {change.notes && ` · ${change.notes}`}</li>)}</ul></details>
      </section>
    })}
    {!!military.supplies.length && <details><summary>Extra supply expenses</summary><ul>{military.supplies.map(supply =>
      <li key={supply.id}>{supply.title} · {formatGp(supply.amount)} {supply.balance} · {date(supply.day)} · First eligible {date(supply.target)}</li>)}</ul></details>}
  </div>
}

function RosterEditor({ calendar, from, unit, previousTerms, currentLocation, correction, submit, cancel }: {
  calendar: Calendar; from: number; unit?: Unit; previousTerms?: Terms; currentLocation?: string; correction?: string
  submit: (change: RosterChange, identity?: Pick<Unit, 'name' | 'type'>) => void; cancel: () => void
}) {
  const [kind, setKind] = useState<RosterChange['kind']>(correction ? 'correction' : unit ? 'arrival' : 'muster')
  const [day, setDay] = useState(from)
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [strength, setStrength] = useState<number | undefined>(unit ? undefined : 1)
  const [location, setLocation] = useState(currentLocation ?? '')
  const [billing, setBilling] = useState<Billing>('home')
  const [terms, setTerms] = useState(previousTerms ?? defaultTerms)
  const [notes, setNotes] = useState('')
  return <form className="form" onSubmit={e => {
    e.preventDefault()
    const base = { id: crypto.randomUUID(), day, notes }
    switch (kind) {
      case 'muster': if (strength) submit({ ...base, kind, strength, location, terms }, { name, type }); break
      case 'arrival': case 'return': submit({ ...base, kind, location }); break
      case 'deployment': submit({ ...base, kind, location, billing }); break
      case 'correction': if (strength !== undefined) submit({ ...base, kind, delta: strength, corrects: correction }); break
      case 'terms': submit({ ...base, kind, terms }); break
      case 'release': submit({ ...base, kind }); break
    }
  }}>
    {correction ? <p>Correct the linked engagement change by entering the additional signed adjustment.</p> : unit ? <label>Roster change<select value={kind} onChange={e => setKind(e.target.value as RosterChange['kind'])}>
      {Object.entries(rosterLabels).filter(([entry]) => entry !== 'muster').map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select></label> : <div className="form-row">
      <label>Unit name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label>
      <label>Unit type<input required maxLength={120} value={type} onChange={e => setType(e.target.value)}/></label>
    </div>}
    <DateField calendar={calendar} value={day} onChange={setDay} label="Effective date"/>
    {(kind === 'muster' || kind === 'correction') && <label>{kind === 'muster' ? 'Opening strength' : 'Strength change (signed)'}
      <input type="number" step="1" min={kind === 'muster' ? 1 : undefined} required value={strength ?? ''}
        onChange={e => setStrength(e.target.value === '' ? undefined : e.target.valueAsNumber)}/></label>}
    {(kind === 'muster' || kind === 'arrival' || kind === 'return' || kind === 'deployment') && <label>Location<input maxLength={120}
      value={location} onChange={e => setLocation(e.target.value)}/></label>}
    {kind === 'deployment' && <label>Deployment costs<select value={billing} onChange={e => setBilling(e.target.value as Billing)}>
      <option value="home">Paid by the home holding</option><option value="unpaid">Unpaid</option><option value="elsewhere">Covered elsewhere</option>
    </select></label>}
    {(kind === 'muster' || kind === 'terms') && <>
      <label>Service arrangement<select value={terms.service} onChange={e => setTerms({ ...terms, service: e.target.value as Terms['service'] })}>
        <option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="obligation">Obligation-based</option>
      </select></label>
      {terms.service === 'paid' && <div className="form-row">
        <label>Pay basis<select value={terms.rateType} onChange={e => setTerms({ ...terms, rateType: e.target.value as Terms['rateType'] })}>
          <option value="unit">Flat per unit</option><option value="troop">Per troop</option>
        </select></label>
        <label>Monthly rate (gp)<input required type="number" step=".01" min=".01" value={terms.rate ? terms.rate / 100 : ''}
          onChange={e => setTerms({ ...terms, rate: Math.round((e.target.valueAsNumber || 0) * 100) })}/></label>
      </div>}
    </>}
    <label>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)}/></label>
    <div className="button-group"><button type="button" onClick={cancel}>Cancel</button><button className="primary">Add to roster history</button></div>
  </form>
}

function SupplyEditor({ calendar, from, units, submit, cancel }: {
  calendar: Calendar; from: number; units: Unit[]; submit: (supply: Omit<Supply, 'target'>) => void; cancel: () => void
}) {
  const [day, setDay] = useState(from)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [balance, setBalance] = useState<Supply['balance']>('cash')
  const [unitId, setUnit] = useState('')
  return <form className="form" onSubmit={e => {
    e.preventDefault()
    submit({ id: crypto.randomUUID(), title, day, amount: Math.round(Number(amount) * 100), balance, unitId: unitId || undefined })
  }}>
    <p className="muted">Propose costs beyond routine upkeep. Approve the amount when closing the turn.</p>
    <label>Expense<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)}/></label>
    <DateField calendar={calendar} value={day} onChange={setDay} label="Supply date"/>
    <label>Unit<select value={unitId} onChange={e => setUnit(e.target.value)}><option value="">Holding-wide</option>
      {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
    <div className="form-row">
      <label>Amount (gp)<input required type="number" step=".01" min=".01" value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label>Balance<select value={balance} onChange={e => setBalance(e.target.value as Supply['balance'])}>
        <option value="cash">Cash</option><option value="noncash">Noncash</option>
      </select></label>
    </div>
    <div className="button-group"><button type="button" onClick={cancel}>Cancel</button><button className="primary">Add supply proposal</button></div>
  </form>
}
