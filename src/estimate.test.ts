import { describe, expect, it } from 'vitest'
import { template } from './calendar'
import { applyProjectEstimate, confirmedCompletion, forecast, newProject, requiredWork } from './construction'
import type { Holding } from './domain'
import { approveEstimate, calculateEstimate, defaultCatalog, newEstimate, type EstimateLine } from './estimate'
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
