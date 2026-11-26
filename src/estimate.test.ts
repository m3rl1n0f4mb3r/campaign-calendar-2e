import { describe, expect, it } from 'vitest'
import { template } from './calendar'
import { applyProjectEstimate, confirmedCompletion, forecast, newProject, requiredWork, staffingRevision } from './construction'
import type { Holding } from './domain'
import { approveEstimate, calculateEstimate, defaultCatalog, newEstimate, staffingPresets, staffingSummary, type EstimateLine } from './estimate'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

function line(moduleId: string, count: number): EstimateLine {
  const module = defaultCatalog().find(item => item.id === moduleId)!
  return { id: module.id, module, description: module.name, unit: module.unit, quantity: count * 100, cost: module.cost, labor: module.labor }
}

describe('castle estimates', () => {
  it('ships all 34 modules with independent catalog values', () => {
    const catalog = defaultCatalog()
    expect(catalog).toHaveLength(34)
    expect(new Set(catalog.map(item => item.id)).size).toBe(34)
    expect(catalog.find(item => item.id === 'gate-grand')).toMatchObject({ technology: 7, cost: 11080000, labor: 641000 })
    expect(catalog.find(item => item.id === 'tunnel')).toMatchObject({ technology: 4, cost: 10000, labor: 2500 })
    catalog[0].cost = 1
    expect(defaultCatalog()[0].cost).toBe(2860000)
  })

  it('computes the two-wall baseline, all finishes, and fractional custom lines', () => {
    const draft = { ...newEstimate(), lines: [line('wall-stone', 2)] }
    expect(calculateEstimate(draft)).toMatchObject({
      base: { cost: '1000', labor: '60' }, overhead: { cost: '1100', labor: '66' }, cost: 110000, labor: 66,
    })
    expect(calculateEstimate({ ...draft, finish: 'ornate' })).toMatchObject({ cost: 165000, labor: 99 })
    expect(calculateEstimate({ ...draft, finish: 'spartan' })).toMatchObject({ cost: 82500, labor: 50 })
    expect(calculateEstimate({
      ...draft, lines: [{ id: 'custom', description: 'Repair', unit: 'area', quantity: 150, cost: 101, labor: 200 }],
    })).toMatchObject({ base: { cost: '1.515', labor: '3' }, cost: 167, labor: 3 })
    expect(() => calculateEstimate({ ...draft, lines: [{ ...draft.lines[0], quantity: 150 }] })).toThrow()
  })

  it('matches Castle on the Moors from the seven source factors through the Production Modifier', () => {
    const draft = { ...newEstimate(), lines: [line('square-small', 8), line('wall-glacis', 70), line('wall-stone', 214), line('wall-wood', 384)],
      factors: { climate: 'Temperate', geography: 'Rolling hills', cover: 'Swamp', resources: 'Distant and good',
        society: 'Agricultural', skill: 'Average', morale: 'High' },
    }
    expect(calculateEstimate(draft)).toMatchObject({
      base: { cost: '271320', labor: '16604' }, overhead: { cost: '298452', labor: '18264' },
      calculatedModifier: 281, appliedModifier: 281, cost: 83865012, labor: 51322,
    })
    expect(() => approveEstimate({ ...draft, modifier: 200 }, 7, 0)).toThrow('reason')
    expect(approveEstimate({ ...draft, modifier: 200, modifierReason: 'Campaign conditions' }, 7, 0).result)
      .toMatchObject({ calculatedModifier: 281, appliedModifier: 200 })
  })

  it('preserves work, setbacks and costs across completion changes, and applies closure dates once', () => {
    const calendar = { ...template(), weekdays: Array.from({ length: 10 }, (_, i) => String(i)) }
    const draft = { ...newEstimate(), lines: [line('wall-stone', 2)], duration: 61 }
    const snapshot = approveEstimate(draft, 10, 3)
    expect(snapshot.workDays).toBe(7)
    const project = { ...newProject(calendar, 0), name: 'Wall',
      stops: [{ id: 'stop', from: 1, through: 2, pace: 0 as const, notes: '' }] }
    const created = applyProjectEstimate(project, snapshot)
    expect(forecast(calendar, created)).toBe(8)
    const progressed = {
      ...created, progress: [{ day: 0, pace: 2 as const }, { day: 3, pace: 2 as const }],
      reviews: [{ id: 'review', month: { year: 0, period: 'month-1' }, extraDays: 1, notes: '' }],
      costs: [{ id: 'cost', source: 'review', title: 'Materials', target: { year: 0, period: 'month-1' },
        category: 'general' as const, balance: 'cash' as const, amount: -500 }],
    }
    const reduced = applyProjectEstimate(progressed, approveEstimate({ ...draft, duration: 10 }, 10, 4))
    expect(requiredWork(reduced)).toBe(4)
    expect(confirmedCompletion(reduced)).toBe(3)
    const reopened = applyProjectEstimate(reduced, approveEstimate({ ...draft, duration: 20 }, 10, 5))
    expect(confirmedCompletion(reopened)).toBeUndefined()
    expect(forecast(calendar, reopened)).toBe(4)
    expect(reopened.progress).toEqual(progressed.progress)
    expect(reopened.costs).toEqual(progressed.costs)
    expect(reopened.reviews).toEqual(progressed.reviews)
    expect(reopened.estimates).toHaveLength(3)
  })

  it('round-trips campaign catalog edits and saved drafts without repricing their lines', () => {
    const campaign = newCampaign('Campaign')
    const draft = { ...newEstimate(), lines: [line('wall-stone', 1)] }
    const catalog = defaultCatalog().map(item => item.id === 'wall-stone' ? { ...item, cost: 99900 } : item)
    catalog.push({ ...catalog[0], id: 'custom-module', name: 'Custom structure' })
    const project = applyProjectEstimate({ ...newProject(campaign.calendar, 0), name: 'Castle' }, approveEstimate(draft, 7, 0))
    const holding: Holding = { id: 'h', name: 'Hold', ruler: 'Ruler', liege: '', first: { year: 0, period: 'month-1' },
      families: 0, tax: 100, services: 1000, resources: [], opening: { cash: 0, noncash: 0 }, turns: [], replay: [], projects: [project] }
    const restored = parseCampaignBackup(exportCampaign({ ...campaign, holdings: [holding], castleCatalog: catalog, castleEstimates: [draft] }))
    expect(restored.castleCatalog?.find(item => item.id === 'wall-stone')?.cost).toBe(99900)
    expect(restored.castleCatalog).toHaveLength(35)
    expect(restored.castleEstimates?.[0].lines[0].cost).toBe(50000)
    expect(restored.holdings?.[0].projects?.[0].estimates).toEqual(project.estimates)
  })
})

describe('construction staffing', () => {
  const estimate = { ...newEstimate(), lines: [{
    id: 'custom', description: 'Castle', unit: 'project', quantity: 100, cost: 10_000_000, labor: 94_500,
  }], staffing: { mode: '100' as const, equivalents: 0, paidCrew: 0, contributionNotes: '', compensation: 0 } }

  it('calculates the source presets and seasonal reference separately from labor and payroll', () => {
    const result = calculateEstimate(estimate)
    expect(result.labor).toBe(1_040)
    for (const [mode, weeks] of Object.entries(staffingPresets)) {
      const plan = { ...estimate, staffing: { ...estimate.staffing, mode: mode as keyof typeof staffingPresets } }
      const snapshot = approveEstimate(plan, 6, 0, mode)
      expect(snapshot.staffing).toMatchObject({ standardCrew: 20, paidCrew: 20 * Number(mode) / 100, remainingWeeks: weeks })
      expect(snapshot.workDays).toBe(weeks * 6)
    }
    const seasonal = { ...estimate, factors: { ...estimate.factors, climate: 'Temperate', cover: 'Swamp' },
      staffing: { ...estimate.staffing, mode: '400' as const, equivalents: 1_150, contributionNotes: 'Allies and tools' } }
    const summary = staffingSummary(seasonal, 51_322)
    expect(summary).toEqual({ standardCrew: 987, paidCrew: 2_798, effectiveCrew: 3_948, workTimeModifier: 2.5 })
    expect(Math.round(52 / summary.workTimeModifier)).toBe(21)
    const contributed = approveEstimate({ ...estimate, staffing: {
      ...estimate.staffing, equivalents: 5, contributionNotes: 'Specialist', compensation: 20_000,
    } }, 6, 0)
    expect(contributed.staffing).toMatchObject({ paidCrew: 15, effectiveCrew: 20, adjustment: -240_000 })
  })

  it('forecasts from the effective date and counts holiday work and closures once', () => {
    const cal = { ...template(), periods: [
      { id: 'festival', name: 'Festival', days: 2, festival: true },
      { id: 'work', name: 'Work month', days: 30, festival: false },
    ] }
    const project = { ...newProject(cal, 0), name: 'Castle', workWeek: 6, festivalPace: 1 as const,
      stops: [{ id: 'winter', from: 2, through: 3, pace: 0 as const, notes: 'Seasonal closure' }] }
    const manual = { ...estimate, duration: 100, approvedBudget: 10_000_000, budgetReason: 'Contract budget', assumptions: 'One week of planned work',
      staffing: { ...estimate.staffing, mode: 'custom' as const, paidCrew: 20 } }
    const initial = applyProjectEstimate(project, approveEstimate(manual, 6, 0, 'initial'))
    expect(forecast(cal, initial)).toBe(8)
    initial.progress = [{ day: 0, pace: 1 }, { day: 1, pace: 0 }]
    const revised = applyProjectEstimate(initial, approveEstimate(manual, 6, 1, 'later',
      staffingRevision(cal, initial, 5, 1)))
    expect(requiredWork(revised)).toBe(13)
    expect(forecast(cal, revised)).toBe(10)
    expect(revised.progress).toEqual(initial.progress)
  })

  it('preserves approved work and replaces the remaining allowance when staffing is revised twice', () => {
    const cal = template()
    const project = { ...newProject(cal, 0), name: 'Castle', workWeek: 6 }
    const baseline = applyProjectEstimate(project, approveEstimate(estimate, 6, 0, 'baseline'))
    baseline.progress = Array.from({ length: 78 }, (_, day) => ({ day, pace: 2 }))
    expect(() => staffingRevision(cal, baseline, 79, 78)).toThrow('pending construction work')
    const double = { ...estimate, staffing: { ...estimate.staffing, mode: '200' as const } }
    const snapshot = approveEstimate(double, 6, 77, 'double', staffingRevision(cal, baseline, 78, 77))
    const revised = applyProjectEstimate(baseline, snapshot)
    expect(snapshot.staffing).toMatchObject({ remainingWeeks: 29.25, adjustment: 585_000, remainingUnits: 352 })
    expect(requiredWork(revised)).toBe(508)
    expect(revised.progress).toEqual(baseline.progress)
    expect(forecast(cal, revised)).toBe(253)
    const later = applyProjectEstimate(revised, approveEstimate(estimate, 6, 77, 'standard', staffingRevision(cal, revised, 78, 77)))
    expect(later.budget).toBe(calculateEstimate(estimate).cost)
    expect(requiredWork(later)).toBe(requiredWork(baseline))
    expect(later.estimates).toHaveLength(3)
    const campaign = newCampaign('Staffing', cal)
    const holding: Holding = { id: 'h', name: 'Hold', ruler: 'GM', liege: '', first: { year: 0, period: cal.periods[0].id },
      families: 1, services: 0, tax: 0, resources: [], opening: { cash: 0, noncash: 0 }, turns: [], replay: [], projects: [later] }
    const restored = parseCampaignBackup(exportCampaign({ ...campaign, holdings: [holding] }))
    expect(restored.holdings?.[0].projects?.[0]).toEqual(later)
  })
})
