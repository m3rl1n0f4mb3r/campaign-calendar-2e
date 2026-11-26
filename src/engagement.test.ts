import { describe, expect, it } from 'vitest'
import { dateIndex } from './calendar'
import { newProject } from './construction'
import { availableEffects, closingDay, recordTurn, reopenTurn, territoryDefaults, type Holding } from './domain'
import { activeSieges, applyConsequence, correctEngagementExpense, engagementEntries, rosterStrength, saveEngagement, type Engagement } from './engagement'
import { migrate } from './migration'
import { greyhawk } from './presets'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

const cal = greyhawk()
const month = { year: 0, period: 'period-6' }
const beforeFestival = dateIndex(cal, { year: 0, period: 'period-4', day: 27 })
const festival = dateIndex(cal, { year: 0, period: 'period-5', day: 1 })
const end = dateIndex(cal, { ...month, day: 2 })
const close = closingDay(cal, month)
const unit = { id: 'guard', name: 'Guard', type: 'Infantry', changes: [
  { id: 'muster', kind: 'muster' as const, day: beforeFestival, strength: 20, location: 'Keep',
    terms: { service: 'unpaid' as const, rateType: 'unit' as const, rate: 0 }, notes: '' },
  { id: 'march', kind: 'deployment' as const, day: end + 1, location: 'Ford', billing: 'home' as const, notes: '' },
] }
const holding: Holding = { id: 'hold', name: 'Riverwatch', ruler: 'Warden', liege: '', first: month, families: 0, tax: 0, services: 0,
  resources: [], opening: { cash: 20_000, noncash: 0 }, turns: [], replay: [], military: { units: [unit], supplies: [] } }
const siege: Engagement = { id: 'siege', title: 'Siege of Riverwatch', kind: 'siege', start: beforeFestival, end, location: 'Keep', holdingId: holding.id,
  participants: [{ id: 'guard', name: 'Guard', side: 'Defenders', holdingId: holding.id, unitId: unit.id },
    { id: 'outsiders', name: 'Outsiders', side: 'Attackers', before: 40, after: 35 }],
  outcome: 'The attackers withdrew.', notes: '', consequences: [] }
const seed = () => ({ ...newCampaign('Riverwatch', cal, close), holdings: [holding] })

describe('battle and siege records', () => {
  it('keeps a siege active through festivals and its inclusive end date', () => {
    const battle: Engagement = { ...siege, id: 'battle', title: 'Battle at the ford', kind: 'battle', start: end, end: undefined }
    expect(activeSieges([siege, battle], beforeFestival - 1)).toEqual([])
    expect(activeSieges([siege, battle], festival)).toEqual([siege])
    expect(activeSieges([siege, battle], end)).toEqual([siege])
    expect(activeSieges([siege], end + 1)).toEqual([])
    expect(activeSieges([{ ...siege, end: undefined }], end + 500)).toHaveLength(1)
    expect(engagementEntries([siege, battle], beforeFestival, end + 1, 'ford').map(entry => entry.title)).toEqual(['Battle at the ford'])
    expect(engagementEntries([siege], beforeFestival, end + 1).map(entry => entry.day)).toEqual([beforeFestival, end])
  })

  it('applies roster losses once and preserves dated corrections, later deployments, and linked receipts', () => {
    const repair = { ...newProject(cal, end), id: 'repair', name: 'Keep repairs', costs: [
      { id: 'masonry', source: 'repair', title: 'Masonry', target: month, category: 'general' as const, balance: 'cash' as const, amount: -1_000 },
    ] }
    const start = { ...seed(), holdings: [{ ...holding, projects: [repair] }] }
    const initial = saveEngagement(start, { ...siege, consequences: [
      { id: 'loss', kind: 'troops', status: 'proposed', holdingId: 'hold', unitId: 'guard', day: end, strength: 20, delta: -5 },
      { id: 'repair-link', kind: 'repair', status: 'proposed', holdingId: 'hold', projectId: repair.id, costId: 'masonry', day: end,
        title: repair.name, budget: repair.budget, workDays: repair.workDays },
      { id: 'confidence', kind: 'confidence', status: 'declined', holdingId: 'hold', day: end },
    ] })
    const applied = applyConsequence(applyConsequence(initial, siege.id, 'loss'), siege.id, 'repair-link')
    expect(() => applyConsequence(applied, siege.id, 'loss')).toThrow('no longer awaiting approval')
    const nextHolding = applied.holdings![0]
    expect(rosterStrength(nextHolding, 'guard', end + 1)).toBe(15)
    expect(availableEffects(nextHolding, month).map(effect => effect.id)).toEqual(['masonry'])
    const posted = recordTurn(cal, close, nextHolding, month, { ...territoryDefaults(nextHolding), effectIds: ['masonry'] })
    posted.military!.units[0].changes.push({ id: 'fix', kind: 'correction', day: end, delta: 2, corrects: 'loss', notes: 'Two returned' })
    const restored = parseCampaignBackup(exportCampaign({ ...applied, current: beforeFestival, holdings: [posted] }))
    const restoredHolding = restored.holdings![0]
    expect(restoredHolding.military!.units[0].changes.map(change => change.id)).toEqual(['muster', 'march', 'loss', 'fix'])
    expect(rosterStrength(restoredHolding, 'guard', end + 1)).toBe(17)
    expect(restoredHolding.turns[0].closing.cash).toBe(19_000)
    expect(restored.engagements![0].consequences[0]).toMatchObject({ status: 'applied', strength: 20, delta: -5 })
    const nextCalendar = { ...cal, periods: cal.periods.map(period => period.id === 'period-5' ? { ...period, days: period.days + 1 } : period) }
    const migrated = migrate(restored, nextCalendar)
    expect(migrated.errors).toEqual([])
    expect(migrated.campaign.engagements![0].end).toBe(end + 1)
    expect(parseCampaignBackup(exportCampaign(migrated.campaign)).holdings![0].turns[0].closing.cash).toBe(19_000)
  })

  it('corrects a single one-off expense only after reopening its posted turn', () => {
    const effect = { id: 'relief', kind: 'expense' as const, status: 'proposed' as const, holdingId: 'hold', day: festival,
      title: 'Relief supplies', amount: 1_000, balance: 'cash' as const }
    const saved = saveEngagement(seed(), { ...siege, consequences: [effect] })
    const applied = applyConsequence(saved, siege.id, effect.id)
    const target = applied.holdings![0]
    const turn = recordTurn(cal, close, target, month, { ...territoryDefaults(target), effectIds: [effect.id] })
    const withTurn = { ...applied, holdings: [turn] }
    const engagement = withTurn.engagements![0]
    expect(() => correctEngagementExpense(withTurn, engagement, { ...effect, amount: 800 })).toThrow('Reopen the posted turn')
    const reopened = { ...withTurn, holdings: [reopenTurn(turn, month)] }
    const corrected = correctEngagementExpense(reopened, engagement, { ...effect, amount: 800 })
    expect(availableEffects(corrected.holdings![0], month)).toMatchObject([{ id: effect.id, amount: -800 }])
    expect(corrected.engagements![0].consequences[0]).toMatchObject({ prior: [{ amount: 1_000 }] })
  })
})
