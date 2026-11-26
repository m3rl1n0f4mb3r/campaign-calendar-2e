import { z } from 'zod'
import { dateIndex, type Calendar } from './calendar'
import type { Holding, Receipt, TurnMonth } from './domain'

const id = z.string().min(1).max(120)
const text = z.string().trim().min(1).max(120)
const day = z.number().int().min(-10_000_000_000).max(10_000_000_000)
const amount = z.number().int().safe().nonnegative()
const balance = z.enum(['cash', 'noncash'])
const terms = z.object({ service: z.enum(['paid', 'unpaid', 'obligation']), rateType: z.enum(['unit', 'troop']), rate: amount })
export const rosterLabels = {
  muster: 'Muster', arrival: 'Arrival', deployment: 'Deployment', return: 'Return',
  correction: 'Strength correction', terms: 'Pay terms', release: 'Release',
} as const
const location = z.string().max(120)
const billing = z.enum(['home', 'unpaid', 'elsewhere'])
const changeBase = z.object({ id, day, notes: z.string() })
const rosterChange = z.discriminatedUnion('kind', [
  changeBase.extend({ kind: z.literal('muster'), strength: amount.positive(), location, terms }),
  changeBase.extend({ kind: z.literal('arrival'), location }),
  changeBase.extend({ kind: z.literal('deployment'), location, billing }),
  changeBase.extend({ kind: z.literal('return'), location }),
  changeBase.extend({ kind: z.literal('correction'), delta: z.number().int().safe() }),
  changeBase.extend({ kind: z.literal('terms'), terms }),
  changeBase.extend({ kind: z.literal('release') }),
])
const unitSchema = z.object({ id, name: text, type: text, archived: z.boolean().optional(), changes: z.array(rosterChange).min(1) })
const supplySchema = z.object({ id, title: text, day, target: day, amount: amount.positive(), balance, unitId: id.optional() }).refine(item => item.day <= item.target)
export const militarySchema = z.object({ units: z.array(unitSchema), supplies: z.array(supplySchema) })
export type Military = z.infer<typeof militarySchema>
export type Unit = z.infer<typeof unitSchema>
export type RosterChange = z.infer<typeof rosterChange>
export type Terms = z.infer<typeof terms>
export type Supply = z.infer<typeof supplySchema>
export type Billing = z.infer<typeof billing>

const militaryChargeSchema = z.object({
  id: z.string().min(1).max(300), title: z.string().trim().min(1).max(242), from: day, through: day,
  balance, amount: amount.optional(), unitId: id.optional(), kind: z.enum(['pay', 'supply']),
  basis: z.array(z.object({ day, rate: z.tuple([amount, z.enum(['unit', 'troop']), amount]).optional() })), carried: z.boolean().optional(),
}).refine(item => item.from <= item.through)
const decision = z.object({ charge: militaryChargeSchema, action: z.enum(['pay', 'skip', 'defer']), amount: amount.optional() })
export const militaryInputsSchema = z.object({ decisions: z.array(decision), acknowledged: z.array(z.string()).optional() })
  .refine(input => new Set(input.decisions.map(item => item.charge.id)).size === input.decisions.length)
export type Charge = z.infer<typeof militaryChargeSchema>
export type ChargeDecision = z.infer<typeof decision>
export type MilitaryInputs = z.infer<typeof militaryInputsSchema>

type UnitState = { strength: number; location: string; billing: Billing; terms: Terms }
type History = { change: RosterChange; state: UnitState }
export const emptyMilitary = (): Military => ({ units: [], supplies: [] })

export function rosterHistory(unit: Unit): History[] {
  let state: UnitState | undefined
  let released = false
  return [...unit.changes].sort((a, b) => a.day - b.day).map(change => {
    if (change.kind === 'muster') {
      if (state) throw new Error('A unit can muster once.')
      state = { strength: change.strength, location: change.location, terms: change.terms, billing: 'home' }
    } else {
      if (!state || released) throw new Error('Roster changes must fall between muster and release.')
      switch (change.kind) {
        case 'arrival': state = { ...state, location: change.location }; break
        case 'deployment': state = { ...state, location: change.location, billing: change.billing }; break
        case 'return': state = { ...state, location: change.location, billing: 'home' }; break
        case 'terms': state = { ...state, terms: change.terms }; break
        case 'correction': state = { ...state, strength: state.strength + change.delta }; break
        case 'release': state = { ...state, strength: 0 }; released = true; break
      }
    }
    if (!Number.isSafeInteger(state.strength) || state.strength < 0) throw new Error('This change makes troop strength invalid on a later roster date.')
    return { change, state }
  })
}

export function validMilitary(military: Military) {
  const ids = [...military.units.flatMap(unit => [unit.id, ...unit.changes.map(change => change.id)]), ...military.supplies.map(supply => supply.id)]
  if (new Set(ids).size !== ids.length) return false
  if (military.supplies.some(supply => supply.unitId && !military.units.some(unit => unit.id === supply.unitId))) return false
  return military.units.every(unit => {
    const latest = rosterHistory(unit).at(-1)
    return !unit.archived || latest?.change.kind === 'release'
  })
}

export function militaryEntries(holdings: readonly Holding[], from: number, to: number, query?: string) {
  return holdings.flatMap(holding => holding.military?.units.flatMap(unit => unit.changes.flatMap(change => {
    const title = `${rosterLabels[change.kind]} · ${unit.name}`
    if (change.kind === 'terms' || change.kind === 'correction' || change.day < from || change.day >= to ||
      (query && !`${title} ${holding.name} ${change.notes} ${'location' in change ? change.location : ''}`.toLowerCase().includes(query.toLowerCase()))) return []
    return [{ holdingId: holding.id, unitId: unit.id, id: change.id, day: change.day, title }]
  })) ?? [])
}

function payBasis(state?: UnitState) {
  if (!state?.strength || state.billing !== 'home' || state.terms.service !== 'paid') return undefined
  return [state.strength, state.terms.rateType, state.terms.rate] as [number, Terms['rateType'], number]
}

function payroll(cal: Calendar, holding: Holding, month: TurnMonth): Charge[] {
  const from = dateIndex(cal, { ...month, day: 1 })
  const through = from + cal.periods.find(period => period.id === month.period)!.days - 1
  return holding.military?.units.flatMap(unit => {
    const timeline = rosterHistory(unit).filter(item => item.change.day <= through)
    const effective = new Map(timeline.map(item => [item.change.day, item.state]))
    const opening = payBasis(timeline.filter(item => item.change.day <= from).at(-1)?.state)
    const changes = [...effective].filter(([day]) => day > from).map(([day, state]) => ({ day, rate: payBasis(state) }))
    let prior = opening
    const differences = changes.filter(({ rate }) => {
      const differs = JSON.stringify(prior) !== JSON.stringify(rate)
      prior = rate
      return differs
    })
    if (!opening && !differences.some(item => item.rate)) return []
    const amount = opening && !differences.length ? opening[2] * (opening[1] === 'unit' ? 1 : opening[0]) : undefined
    const basis = [{ day: from, rate: opening }, ...differences]
    return [{
      id: `pay:${unit.id}:${month.year}:${month.period}`, title: `Pay · ${unit.name}`, from, through, balance: 'cash', kind: 'pay',
      unitId: unit.id, amount: Number.isSafeInteger(amount) ? amount : undefined, basis,
    }]
  }) ?? []
}

export function militaryChargeState(turns: readonly Receipt[]) {
  const pending = new Map<string, Charge>()
  const closed = new Set<string>()
  for (const turn of turns) {
    for (const decision of turn.inputs.military?.decisions ?? []) {
      const { charge, action, amount } = decision
      if (closed.has(charge.id) || (!!charge.carried && !pending.has(charge.id)) || (action !== 'skip' && !amount)) {
        throw new Error('Invalid military charge history.')
      }
      if (action === 'defer') pending.set(charge.id, { ...charge, carried: true, amount })
      else { pending.delete(charge.id); closed.add(charge.id) }
    }
  }
  return { pending, closed }
}

export function militaryCharges(cal: Calendar, holding: Holding, month: TurnMonth) {
  const { pending, closed } = militaryChargeState(holding.turns)
  const through = dateIndex(cal, { ...month, day: cal.periods.find(item => item.id === month.period)!.days })
  const supplyCharges: Charge[] = (holding.military?.supplies ?? []).filter(item => item.target <= through).map(item => ({
    id: `supply:${item.id}`, title: item.title, from: item.day, through: item.day, balance: item.balance,
    amount: item.amount, unitId: item.unitId, kind: 'supply', basis: [],
  }))
  return [...pending.values(), ...[...payroll(cal, holding, month), ...supplyCharges].filter(item => !pending.has(item.id) && !closed.has(item.id))]
}

export function militaryConflicts(cal: Calendar, holding: Holding, month: TurnMonth) {
  const replay = holding.replay.find(item => item.month.year === month.year && item.month.period === month.period)
  const { pending, closed } = militaryChargeState(holding.turns)
  return (replay?.inputs.military?.decisions ?? []).filter(({ charge }) =>
    closed.has(charge.id) || (!!charge.carried && !pending.has(charge.id)))
}

export function validateMilitaryTurn(cal: Calendar, holding: Holding, month: TurnMonth, inputs?: MilitaryInputs) {
  const conflicts = militaryConflicts(cal, holding, month)
  if (conflicts.some(item => !inputs?.acknowledged?.includes(item.charge.id))) {
    throw new Error('Review the military charges that are no longer pending before recording this turn.')
  }
  const parsed = inputs && militaryInputsSchema.parse(inputs)
  const current = militaryCharges(cal, holding, month)
  const replay = holding.replay.find(item => item.month.year === month.year && item.month.period === month.period)
  const previous = replay?.inputs.military?.decisions.map(item => item.charge) ?? []
  const allowed = new Map(current.map(item => [item.id, [item]]))
  for (const item of previous) {
    if (!conflicts.some(conflict => conflict.charge.id === item.id)) allowed.set(item.id, [...(allowed.get(item.id) ?? []), item])
  }
  const used = new Set<string>()
  const decisions = [...(parsed?.decisions ?? [])]
  for (const { charge, action, amount } of decisions) {
    if (used.has(charge.id) || !allowed.get(charge.id)?.some(item => JSON.stringify(militaryChargeSchema.parse(item)) === JSON.stringify(charge))) {
      throw new Error('A military charge changed or is no longer pending. Review it before recording this turn.')
    }
    if (action !== 'skip' && (!amount || !Number.isSafeInteger(amount))) throw new Error('Enter a positive amount for each approved or deferred military charge.')
    used.add(charge.id)
  }
  for (const charge of current) {
    if (!used.has(charge.id)) decisions.push(charge.carried ? { charge, action: 'defer', amount: charge.amount } : { charge, action: 'skip' })
  }
  return decisions.length || parsed?.acknowledged?.length ? { ...parsed, decisions } : undefined
}

export function militaryReceiptChanged(cal: Calendar, holding: Holding, turn: Receipt) {
  const current = payroll(cal, holding, turn.month)
  const saved = (turn.inputs.military?.decisions ?? []).filter(item => !item.charge.carried && item.charge.kind === 'pay').map(item => item.charge)
  return current.length !== saved.length || current.some(charge => !saved.some(item => item.id === charge.id && JSON.stringify(item.basis) === JSON.stringify(charge.basis)))
}
