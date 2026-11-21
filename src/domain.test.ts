import { describe, expect, it } from 'vitest'
import { dateIndex, template } from './calendar'
import {
  closingDay, dueMonth, holdingDefaults, monthAt, previewTurn, recordTurn, reopenTurn,
  replayInputs, turnEntries, populationGrowth, territoryDefaults, type Holding,
} from './domain'
import { migrate } from './migration'
import { greyhawk } from './presets'
import { exportCampaign, key, newCampaign, parseCampaignBackup, parseStore, saveIfCurrent, type Store } from './storage'

function barony(): Holding {
  return {
    id: 'barony', name: 'Barony', ruler: 'Ada', liege: 'The count',
    first: { year: 0, period: 'month-1' }, opening: { cash: 0, noncash: 0 },
    families: 200, tax: 100, services: 1000,
    resources: [{ name: 'Herds', type: 'animal' }, { name: 'Mine', type: 'mineral' }],
    turns: [], replay: [],
  }
}

describe('domain turns', () => {
  it('matches the Companion barony example and tracks cash realization and debits exactly', () => {
    const holding = barony()
    const original = holdingDefaults(holding)
    const income = previewTurn(holding, holding.first, original)
    expect(income.gross).toBe(320_000)
    expect(income.closing).toEqual({ cash: 20_000, noncash: 300_000 })
    expect(income.inputs.resources.map(item => item.rate)).toEqual([200, 300])
    const adjusted = previewTurn(holding, holding.first, {
      ...original, realized: 30_000,
      adjustments: [{ name: 'Supplies', balance: 'cash', amount: -12_550 }],
    })
    expect(adjusted.closing).toEqual({ cash: 37_450, noncash: 270_000 })
    expect(adjusted.gross).toBe(income.gross)
  })

  it('carries forward noncash value and posts only the expiration the GM enters', () => {
    const holding = { ...barony(), families: 0, opening: { cash: 0, noncash: 15_000 } }
    const draft = holdingDefaults(holding)
    expect(previewTurn(holding, holding.first, draft).closing.noncash).toBe(15_000)
    const adjusted = { ...draft, adjustments: [{ name: 'Expired labor', balance: 'noncash' as const, amount: -3500 }] }
    expect(previewTurn(holding, holding.first, adjusted).closing.noncash).toBe(11_500)
    expect(() => previewTurn(holding, holding.first, { ...draft, realized: 1 })).toThrow('exceeds')
    expect(() => previewTurn(holding, holding.first, {
      ...draft, adjustments: [{ name: 'Invoice', balance: 'cash', amount: -1 }],
    })).toThrow('short by')
    expect(holding.turns).toHaveLength(0)
  })

  it('crosses Greyhawk festivals and catches up one due month at a time', () => {
    const calendar = greyhawk()
    const first = { year: 0, period: 'period-4' }
    const holding = { ...barony(), first }
    const close = closingDay(calendar, first)
    const planting = { year: 0, period: 'period-6' }
    expect(monthAt(calendar, close + 1)).toEqual(planting)
    expect(() => recordTurn(calendar, close - 1, holding, first, holdingDefaults(holding))).toThrow('no longer due')
    const posted = recordTurn(calendar, close + 90, holding, first, holdingDefaults(holding))
    expect(dueMonth(calendar, posted)).toEqual(planting)
    expect(() => recordTurn(calendar, close + 90, posted, first, holdingDefaults(posted))).toThrow('no longer due')
    expect(() => recordTurn(calendar, close + 1, posted, planting, holdingDefaults(posted))).toThrow('no longer due')
    expect(turnEntries(calendar, [posted], close, close + 1)).toHaveLength(1)
  })

  it('reopens a holding suffix and replays each month from original inputs with new opening balances', () => {
    const calendar = template()
    const holding = barony()
    const first = holding.first
    const January = recordTurn(calendar, 59, holding, first, holdingDefaults(holding))
    const second = dueMonth(calendar, January)
    const February = recordTurn(calendar, 59, January, second, { ...holdingDefaults(January), notes: 'Winter goods' })
    const updated = { ...February, tax: 250 }
    expect(turnEntries(calendar, [updated], 0, 60)).toHaveLength(2)
    const reopened = reopenTurn(updated, first)
    expect(dueMonth(calendar, reopened)).toEqual(first)
    expect(turnEntries(calendar, [reopened], 0, 60)).toHaveLength(0)
    expect(replayInputs(reopened, first).tax).toBe(100)
    expect(holdingDefaults(reopened).tax).toBe(250)
    const replayed = recordTurn(calendar, 59, reopened, first, holdingDefaults(reopened))
    expect(replayed.replay).toHaveLength(1)
    expect(replayInputs(replayed, second).notes).toBe('Winter goods')
    expect(previewTurn(replayed, second, replayInputs(replayed, second)).opening.cash).toBe(50_000)
  })

  it('keeps receipts and replay drafts in active campaign backups', () => {
    const campaign = newCampaign('Campaign')
    const holding = barony()
    const posted = recordTurn(campaign.calendar, 29, holding, holding.first, holdingDefaults(holding))
    const restored = parseCampaignBackup(exportCampaign({
      ...campaign, holdings: [posted, { ...reopenTurn(posted, holding.first), id: 'second' }],
    }))
    expect(restored.holdings?.[0].turns).toEqual(posted.turns)
    expect(restored.holdings?.[1].replay[0].inputs).toEqual(posted.turns[0].inputs)
  })

  it('previews new closing dates without changing recorded amounts and blocks festival conversion', () => {
    const campaign = newCampaign('Campaign')
    const holding = barony()
    const posted = recordTurn(campaign.calendar, 29, holding, holding.first, holdingDefaults(holding))
    const withDomain = { ...campaign, holdings: [posted] }
    const next = template()
    next.periods[0].days = 28
    const preview = migrate(withDomain, next)
    expect(preview.errors).toHaveLength(0)
    expect(preview.affected).toContainEqual({ before: 29, after: 27 })
    expect(preview.campaign.holdings?.[0].turns[0]).toEqual(posted.turns[0])
    expect(turnEntries(next, [posted], 0, 29)[0].day).toBe(27)
    expect(dateIndex(next, { ...dueMonth(next, posted), day: 1 })).toBe(28)
    next.periods[0].festival = true
    expect(migrate(withDomain, next).errors.join()).toContain('changed to a festival')
  })

  it('rejects a stale write against the same saved revision', () => {
    const campaign = newCampaign('Campaign')
    const store: Store = { version: 1, active: campaign.id, campaigns: [campaign] }
    let raw: string | null = null
    const storage = {
      getItem: () => raw,
      setItem: (name: string, value: string) => { expect(name).toBe(key); raw = value },
    }
    const initial = saveIfCurrent(storage, null, store)
    const holding = barony()
    const posted = recordTurn(campaign.calendar, 29, holding, holding.first, holdingDefaults(holding))
    const after = { ...store, campaigns: [{ ...campaign, holdings: [posted] }] }
    expect(saveIfCurrent(storage, initial.raw, after).saved).toBe(true)
    expect(saveIfCurrent(storage, initial.raw, store).saved).toBe(false)
    expect(parseStore(raw!).campaigns[0].holdings?.[0].turns).toHaveLength(1)
  })
})

describe('territory population', () => {
  const pastures = { id: 'pastures', name: 'Pastures', externalId: '0812', settlement: 'wilderness',
    families: 100, resources: [{ name: 'Herds', type: 'animal' }] } as const
  const mine = { id: 'mine', name: 'Mine', settlement: 'borderland',
    families: 200, resources: [{ name: 'Ore', type: 'mineral' }] } as const
  const multiHex = (): Holding => ({
    ...barony(), families: 300, resources: [],
    territories: [{ ...pastures, resources: [...pastures.resources] }, { ...mine, resources: [...mine.resources] }],
  })

  it('checks growth brackets, floors fractions, and offers zero growth on the first territory turn', () => {
    expect([0, 100, 101, 500, 501].map(families => populationGrowth(families, 1)))
      .toEqual([{ rate: 0, suggested: 0 }, { rate: 25, suggested: 25 }, { rate: 20, suggested: 20 },
        { rate: 5, suggested: 25 }, { rate: 1, suggested: 5 }])
    const holding = barony()
    const defaults = territoryDefaults(holding)
    expect(defaults.territories?.[0]).toMatchObject({ families: 200, applyGrowth: false })
    const first = { ...defaults.territories![0], applyGrowth: true, adjustment: 5, roll: { die: 5, sign: 1 as const } }
    const result = previewTurn(holding, holding.first, { ...defaults, territories: [first] })
    expect(result.inputs.families).toBe(245)
    expect(result.gross).toBe(392_000)
    expect(() => previewTurn(holding, holding.first, {
      ...defaults, territories: [{ ...first, roll: undefined, adjustment: -241 }],
    })).toThrow('nonnegative')
  })

  it('aggregates each territory independently and retains its breakdown under a resource override', () => {
    const holding = multiHex()
    const defaults = territoryDefaults(holding)
    const first = previewTurn(holding, holding.first, defaults)
    expect(first.territories?.map(item => item.production)).toEqual([20_000, 60_000])
    expect(first.inputs.families).toBe(300)
    const territories = defaults.territories!.map(item => ({ ...item, adjustment: item.id === 'pastures' ? -10 : 10 }))
    const moved = previewTurn(holding, holding.first, { ...defaults, territories })
    const overridden = previewTurn(holding, holding.first, { ...defaults, territories, override: 70_000 })
    expect(moved.inputs.families).toBe(300)
    expect(moved.territories?.map(item => item.production)).toEqual([18_000, 63_000])
    expect(overridden.territories).toEqual(moved.territories)
    expect(overridden.gross).toBe(moved.gross - 11_000)
  })

  it('recalculates replay from the prior month and retains removed territory and external IDs only in receipts', () => {
    const cal = template()
    const holding = multiHex()
    const first = recordTurn(cal, 59, holding, holding.first, territoryDefaults(holding))
    const secondMonth = dueMonth(cal, first)
    const draft = territoryDefaults(first)
    const second = recordTurn(cal, 59, first, secondMonth, {
      ...draft, override: 85_000,
      territories: draft.territories!.map(item => item.id === 'pastures'
        ? { ...item, override: 160, adjustment: -3, roll: { die: 3, sign: -1 as const } } : item),
    })
    const changed = { ...second, territories: [{ ...second.territories![0], externalId: '0099' }] }
    const reopened = reopenTurn(changed, holding.first)
    const replayFirst = replayInputs(reopened, holding.first)
    const corrected = recordTurn(cal, 59, reopened, holding.first, {
      ...replayFirst, territories: replayFirst.territories!.map(item => item.id === 'pastures' ? { ...item, adjustment: 10 } : item),
    })
    const replaySecond = replayInputs(corrected, secondMonth)
    expect(replaySecond.override).toBe(85_000)
    expect(replaySecond.territories?.[0]).toMatchObject({ families: 110, externalId: '0812', roll: { die: 3, sign: -1 } })
    expect(replaySecond.territories?.[0].override).toBeUndefined()
    const replayed = recordTurn(cal, 59, corrected, secondMonth, replaySecond)
    expect(replayed.turns[1].territories?.map(item => item.closing)).toEqual([129, 240])
    expect(replayed.territories).toHaveLength(1)
    expect(replayed.territories?.[0]).toMatchObject({ externalId: '0099', families: 129 })
    const campaign = newCampaign('Campaign')
    const restored = parseCampaignBackup(exportCampaign({ ...campaign, holdings: [replayed] }))
    expect(restored.holdings?.[0].turns[1].inputs.territories?.[0].externalId).toBe('0812')
    expect(restored.holdings?.[0].territories?.[0].externalId).toBe('0099')
  })

  it('leaves legacy receipts and replay inputs intact when a holding starts using territories', () => {
    const cal = template()
    const old = barony()
    const before = recordTurn(cal, 59, old, old.first, holdingDefaults(old))
    const due = dueMonth(cal, before)
    const after = recordTurn(cal, 59, before, due, territoryDefaults(before))
    expect(after.turns[0]).toEqual(before.turns[0])
    expect(after.territories).toHaveLength(1)
    const reopened = reopenTurn(after, old.first)
    expect(replayInputs(reopened, old.first).territories).toBeUndefined()
    expect(replayInputs(reopened, due).territories?.[0].id).toBe(after.territories?.[0].id)
  })
})
