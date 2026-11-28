import { describe, expect, it } from 'vitest'
import { dateParts } from './calendar'
import { confirmedCompletion } from './construction'
import { nextMonth } from './domain'
import { occurrences } from './events'
import { rosterStrength } from './engagement'
import { exampleCampaign } from './exampleCampaign'
import { initializeCampaigns } from './startup'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

describe('Example Campaign', () => {
  it('shows a welcoming midyear event and four linked, consecutive fiscal-year ledgers', () => {
    const sample = parseCampaignBackup(exportCampaign(exampleCampaign()))
    expect(sample.name).toBe('Example Campaign')
    expect(sample.calendar.moons).toHaveLength(3)
    expect(sample.calendar.periods.filter(item => item.festival)).toHaveLength(4)
    expect(dateParts(sample.calendar, sample.current)).toEqual({ year: 1, period: 'month-7', day: 12 })
    expect(occurrences(sample.calendar, sample.events, sample.current, sample.current + 1).map(item => item.title)).toContain('Rivergate Bridge Reopens')
    const holdings = sample.holdings!
    expect(new Set(holdings.map(item => item.ruler)).size).toBe(4)
    for (const holding of holdings) {
      expect(holding.turns).toHaveLength(12)
      expect(holding.turns[0].month).toEqual({ year: 0, period: 'month-7' })
      expect(holding.turns.at(-1)?.month).toEqual({ year: 1, period: 'month-6' })
      for (const [index, receipt] of holding.turns.entries()) {
        if (index === 0) continue
        const previous = holding.turns[index - 1]
        expect(receipt.opening).toEqual(previous.closing)
        expect(receipt.month).toEqual(nextMonth(sample.calendar, previous.month))
      }
    }
    const [rivergate, willowbank] = holdings
    expect(confirmedCompletion(rivergate.projects![0])).toBeDefined()
    expect(rivergate.turns.flatMap(turn => turn.inputs.effectIds)).toEqual(expect.arrayContaining(['wall-materials', 'wall-labor', 'bridge-repair']))
    const deferred = rivergate.turns[0].inputs.military!.decisions[0]
    expect(deferred.action).toBe('defer')
    expect(rivergate.turns[1].inputs.military?.decisions).toContainEqual(expect.objectContaining({ action: 'pay', charge: expect.objectContaining({ id: deferred.charge.id, carried: true }) }))
    expect(willowbank.turns.some(turn => turn.inputs.effectIds?.includes('lost-fruit'))).toBe(true)
    const engagement = sample.engagements![0]
    expect(sample.resolutions?.[0].engagementId).toBe(engagement.id)
    expect(rosterStrength(rivergate, 'river-guard', engagement.end!)).toBe(21)
    expect(exampleCampaign()).toEqual(exampleCampaign())
  })

  it('loads the starter only on a fresh profile and keeps returning campaigns active', async () => {
    const clean = newCampaign('My campaign')
    expect(clean.events).toEqual([])
    expect(clean.holdings).toBeUndefined()
    const sample = exampleCampaign()
    let raw: string | null = null
    let calls = 0
    const storage = { getItem: () => raw }
    const load = async () => { calls++; return sample }
    const fresh = await initializeCampaigns(storage, load)
    expect(fresh.store.active).toBe(sample.id)
    expect(fresh.raw).toBeNull()
    raw = JSON.stringify({ ...fresh.store, active: clean.id, campaigns: [...fresh.store.campaigns, clean] })
    const returning = await initializeCampaigns(storage, load)
    expect(calls).toBe(1)
    expect(returning.store.active).toBe(clean.id)
    expect(returning.store.campaigns.find(item => item.id === sample.id)?.holdings).toHaveLength(4)
    const old = newCampaign('Example Campaign')
    raw = JSON.stringify({ version: 1, active: old.id, campaigns: [old] })
    expect((await initializeCampaigns(storage, load)).store.campaigns).toEqual([old])
    raw = null
    const concurrent = await initializeCampaigns(storage, async () => {
      raw = JSON.stringify({ version: 1, active: clean.id, campaigns: [clean] })
      return sample
    })
    expect(concurrent.store.campaigns).toEqual([clean])
  })
})
