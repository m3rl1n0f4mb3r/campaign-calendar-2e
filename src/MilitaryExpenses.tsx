import { dateLabel, type Calendar } from './calendar'
import { formatGp, type Holding, type TurnMonth } from './domain'
import { militaryCharges, militaryConflicts, type Charge, type ChargeDecision, type MilitaryInputs } from './military'

const actions = { pay: 'Pay', skip: 'Skip', defer: 'Defer' } as const

export function MilitaryDecisionSummary({ calendar, decision }: { calendar: Calendar; decision: ChargeDecision }) {
  const { charge, amount, action } = decision
  return <>{charge.title} · {serviceDates(calendar, charge)} · {actions[action]}{amount === undefined ? '' : ` · ${formatGp(amount)} ${charge.balance}`}</>
}

function serviceDates(calendar: Calendar, charge: Charge) {
  const first = dateLabel(calendar, charge.from)
  return charge.from === charge.through ? first : `${first} – ${dateLabel(calendar, charge.through)}`
}

export function MilitaryExpenses({ calendar, holding, month, value, original, change }: {
  calendar: Calendar; holding: Holding; month: TurnMonth; value?: MilitaryInputs; original?: MilitaryInputs
  change: (value: MilitaryInputs) => void
}) {
  const decisions = value?.decisions ?? []
  const conflicts = militaryConflicts(calendar, holding, month)
  const charges = new Map(militaryCharges(calendar, holding, month).map(charge => [charge.id, charge]))
  for (const { charge } of decisions) charges.set(charge.id, charge)
  for (const { charge } of conflicts) charges.delete(charge.id)
  if (!charges.size && !conflicts.length && !original?.decisions.length) return null

  const update = (charge: Charge, patch: Partial<Pick<ChargeDecision, 'action' | 'amount'>>) => {
    const decision = decisions.find(item => item.charge.id === charge.id)
    const fallback = { charge, action: charge.carried ? 'defer' as const : 'skip' as const, amount: charge.amount }
    change({ ...value, decisions: [...decisions.filter(item => item.charge.id !== charge.id), { ...fallback, ...decision, ...patch }] })
  }
  return <fieldset className="form"><legend>Military expenses</legend>
    <p>Unselected new charges are skipped. Deferred charges stay pending with their original service dates until you pay or skip them.</p>
    {!!original?.decisions.length && <>
      <details><summary>Original military decisions</summary><ul>{original.decisions.map(item =>
        <li key={item.charge.id}><MilitaryDecisionSummary calendar={calendar} decision={item}/></li>)}</ul></details>
      <button type="button" onClick={() => change({ ...value, decisions: [] })}>Recalculate military expenses from current roster</button>
    </>}
    {conflicts.map(item => <div className="warning" key={item.charge.id}>
      <p>No longer pending. Original decision <MilitaryDecisionSummary calendar={calendar} decision={item}/>.</p>
      <label className="check"><input type="checkbox" checked={value?.acknowledged?.includes(item.charge.id) ?? false} onChange={e => change({
        decisions: decisions.filter(decision => decision.charge.id !== item.charge.id),
        acknowledged: e.target.checked ? [...(value?.acknowledged ?? []), item.charge.id] : value?.acknowledged?.filter(id => id !== item.charge.id),
      })}/> Reviewed removal of this charge from the replay</label>
    </div>)}
    {[...charges.values()].map(charge => {
      const saved = decisions.find(item => item.charge.id === charge.id)
      const unit = holding.military?.units.find(item => item.id === charge.unitId)
      const action = saved?.action ?? (charge.carried ? 'defer' : 'skip')
      const amount = saved ? saved.amount : charge.amount
      return <section className="form domain-holding" key={charge.id}>
        <strong>{charge.title} {charge.carried && <span className="workflow-status">Deferred</span>}
          {action !== 'skip' && !amount && <span className="workflow-status workflow-status-pending">Needs an amount</span>}</strong>
        <p>{serviceDates(calendar, charge)}{charge.kind === 'supply' && ` · ${unit?.name ?? 'Holding-wide'}`} · {charge.balance}{charge.amount === undefined ? ' · Enter a GM-approved amount' : ` · ${formatGp(charge.amount)} suggested`}</p>
        {!!charge.basis.length && <ul>{charge.basis.map(({ day, rate }) => <li key={day}>{dateLabel(calendar, day)} · {rate
          ? `${rate[0]} troops · ${formatGp(rate[2])} per ${rate[1]} per month` : 'No pay due'}</li>)}</ul>}
        <div className="form-row">
          <label>Decision<select value={action} onChange={e => update(charge, { action: e.target.value as ChargeDecision['action'] })}>
            <option value="skip">Skip</option><option value="pay">Approve payment</option><option value="defer">Defer</option>
          </select></label>
          {action !== 'skip' && <label>Approved amount (gp)<input type="number" min=".01" step=".01" required
            value={amount === undefined ? '' : amount / 100}
            onChange={e => update(charge, { amount: e.target.value === '' ? undefined : Math.round(e.target.valueAsNumber * 100) })}/></label>}
        </div>
      </section>
    })}
  </fieldset>
}
