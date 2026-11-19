import { describe, expect, it } from 'vitest'
import { dateIndex, template } from './calendar'
import {
  closingDay, dueMonth, holdingDefaults, monthAt, previewTurn, recordTurn, reopenTurn,
  replayInputs, turnEntries, type Holding,
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
