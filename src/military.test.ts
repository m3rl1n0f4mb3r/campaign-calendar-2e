import { describe, expect, it } from 'vitest'
import { dateIndex, type Calendar } from './calendar'
import { closingDay, monthAt, recordTurn, reopenTurn, replayInputs, territoryDefaults, type Holding, type TurnMonth } from './domain'
import { militaryCharges, militaryConflicts, militaryEntries, militaryReceiptChanged, rosterHistory, type ChargeDecision, type Unit } from './military'
import { migrate } from './migration'
import { greyhawk } from './presets'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

const cal = greyhawk()
const first = { year: 0, period: 'period-2' }
const second = { year: 0, period: 'period-3' }
const third = { year: 0, period: 'period-4' }
const festival = dateIndex(cal, { year: 0, period: 'period-5', day: 1 })
const date = (month: TurnMonth, day: number) => dateIndex(cal, { ...month, day })
const terms = { service: 'paid', rateType: 'troop', rate: 200 } as const
const company: Unit = { id: 'guard', name: 'River guard', type: 'Infantry', changes: [
  { id: 'muster', kind: 'muster', day: date(first, 1), strength: 10, location: 'Castle', terms, notes: '' },
] }
const makeHolding = (units: Unit[]): Holding => ({
  id: 'hold', name: 'Riverwatch', ruler: 'Warden', liege: '', first, opening: { cash: 100_000, noncash: 100_000 },
  families: 0, tax: 0, services: 0, resources: [], turns: [], replay: [], military: { units, supplies: [] },
})
const post = (holding: Holding, month: TurnMonth, decisions: ChargeDecision[] = [], acknowledged?: string[]) =>
  recordTurn(cal, closingDay(cal, month), holding, month, {
    ...territoryDefaults(holding), military: { decisions, acknowledged },
  })

describe('garrison rosters and military expenses', () => {
  it('uses the last day-one pay terms and ignores a location-only deployment', () => {
    const unit: Unit = { ...company, changes: [...company.changes,
      { id: 'troops', kind: 'correction', day: date(first, 1), delta: 2, notes: '' },
      { id: 'rate', kind: 'terms', day: date(first, 1), terms: { ...terms, rate: 250 }, notes: '' },
      { id: 'move', kind: 'deployment', day: date(first, 5), location: 'Border', billing: 'home', notes: '' },
      { id: 'raise', kind: 'terms', day: date(second, 11), terms: { ...terms, rate: 300 }, notes: '' },
    ] }
    const holding = makeHolding([unit])
    expect(militaryCharges(cal, holding, first)[0]).toMatchObject({ amount: 3_000, basis: [{ day: date(first, 1), rate: [12, 'troop', 250] }] })
    const later = militaryCharges(cal, holding, second)[0]
    expect(later.amount).toBeUndefined()
    expect(later.basis).toHaveLength(2)
    expect(militaryEntries([holding], 0, festival).map(item => item.id)).toEqual(['muster', 'move'])
    expect(() => rosterHistory({ ...unit, changes: [...unit.changes,
      { id: 'losses', kind: 'correction', day: date(first, 2), delta: -13, notes: '' }],
    })).toThrow('troop strength invalid')
  })

  it.each(['pay', 'skip'] as const)('requires review when replay changes a deferral to %s', action => {
    const holding = makeHolding([company])
    const charge = militaryCharges(cal, holding, first)[0]
    const deferred = post(holding, first, [{ charge, action: 'defer', amount: 1_500 }])
    const [pending, newMonth] = militaryCharges(cal, deferred, second)
    expect(pending).toMatchObject({ id: charge.id, carried: true, amount: 1_500, from: date(first, 1), through: closingDay(cal, first) })
    expect(newMonth.id).not.toBe(charge.id)
    const paid = post(deferred, second, [{ charge: pending, action: 'pay', amount: 1_500 }])
    expect(paid.turns[1].closing.cash).toBe(98_500)
    expect(militaryCharges(cal, paid, third).map(item => item.id)).not.toContain(charge.id)

    const reopened = reopenTurn(paid, first)
    expect(replayInputs(reopened, first).military?.decisions[0]).toMatchObject({ action: 'defer', amount: 1_500 })
    const corrected = post(reopened, first, [{ charge, action, amount: action === 'pay' ? 1_500 : undefined }])
    expect(militaryConflicts(cal, corrected, second)[0]).toMatchObject({ charge: { id: charge.id }, action: 'pay' })
    expect(() => post(corrected, second)).toThrow('no longer pending')
    expect(() => post(corrected, second, [{ charge: pending, action: 'pay', amount: 1_500 }], [charge.id])).toThrow('no longer pending')
    const replayed = post(corrected, second, [], [charge.id])
    expect(replayed.turns[1].closing.cash).toBe(action === 'pay' ? 98_500 : 100_000)
  })

  it('retains intentional deferrals and posts an exceptional festival expense to noncash once', () => {
    const levy: Unit = { ...company, id: 'levy', name: 'Levy', changes: [
      { id: 'levy-muster', kind: 'muster', day: date(first, 10), strength: 20, location: '', terms: { ...terms, service: 'obligation' }, notes: '' },
    ] }
    const deployed: Unit = { ...company, changes: [...company.changes,
      { id: 'festival-deployment', kind: 'deployment', day: festival, location: 'Border', billing: 'elsewhere', notes: '' },
    ] }
    let holding = makeHolding([deployed, levy])
    const charge = militaryCharges(cal, holding, first)[0]
    holding = post(holding, first, [{ charge, action: 'defer', amount: 1_500 }])
    holding = post(holding, second)
    expect(militaryCharges(cal, holding, third)[0]).toMatchObject({ id: charge.id, carried: true, amount: 1_500 })
    holding = post(holding, third)
    const next = monthAt(cal, festival)
    holding.military!.supplies.push({ id: 'supplies', day: festival, target: closingDay(cal, next), title: 'Festival supplies', amount: 250, balance: 'noncash' })
    const proposals = militaryCharges(cal, holding, next)
    expect(proposals.map(item => item.kind)).toEqual(['pay', 'supply'])
    expect(militaryEntries([holding], festival, festival + 1)[0].id).toBe('festival-deployment')
    const booked = post(holding, next, [{ charge: proposals[1], action: 'pay', amount: 250 }])
    expect(booked.turns.at(-1)?.closing.noncash).toBe(99_750)
    const campaign = newCampaign('Riverwatch', cal, closingDay(cal, next))
    const restored = parseCampaignBackup(exportCampaign({ ...campaign, holdings: [booked] }))
    expect(restored.holdings?.[0].military).toEqual(booked.military)
    expect(restored.holdings?.[0].turns.at(-1)?.inputs.military).toEqual(booked.turns.at(-1)?.inputs.military)
  })

  it('flags new payroll after backdated changes and previews migrated military dates', () => {
    const holding = makeHolding([company])
    const charge = militaryCharges(cal, holding, first)[0]
    const paid = post(holding, first, [{ charge, action: 'pay', amount: charge.amount }])
    const backdated: Unit = { ...company, changes: [...company.changes,
      { id: 'correction', kind: 'correction', day: date(first, 5), delta: 1, notes: '' },
    ] }
    const amended = { ...paid, military: { ...paid.military!, units: [backdated] } }
    expect(militaryReceiptChanged(cal, amended, paid.turns[0])).toBe(true)
    expect(amended.turns[0].closing.cash).toBe(98_000)
    const campaign = newCampaign('Riverwatch', cal, date(first, 17))
    const changedCalendar: Calendar = { ...cal, periods: cal.periods.map(item => item.festival ? { ...item, days: item.days + 1 } : item) }
    const migration = migrate({ ...campaign, holdings: [amended] }, changedCalendar)
    expect(migration.errors).toEqual([])
    const moved = migration.campaign.holdings![0]
    expect(rosterHistory(moved.military!.units[0])[1].change.day).toBe(date(first, 5) + 1)
    expect(moved.turns[0].inputs.military?.decisions[0].charge.from).toBe(date(first, 1) + 1)
    expect(moved.turns[0].closing.cash).toBe(98_000)
  })
})
