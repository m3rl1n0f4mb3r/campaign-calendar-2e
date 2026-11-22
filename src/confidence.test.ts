import { describe, expect, it } from 'vitest'
import { dateIndex, template } from './calendar'
import { confidenceBand, drawEvents, eventOptions, initialConfidence, nextReview, recordCheck, recordReview, yearStart } from './confidence'
import { availableEffects, closingDay, dominionEntries, previewTurn, recordTurn, reopenTurn, replayInputs, territoryDefaults, type Holding } from './domain'
import { migrate } from './migration'
import { greyhawk } from './presets'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

describe('confidence and events', () => {
  it('reviews a festival year boundary once, and skips the next review without resetting', () => {
    const calendar = greyhawk()
    const start = dateIndex(calendar, { year: 0, period: 'period-2', day: 1 })
    const boundary = yearStart(calendar, 1)
    let state = { ...initialConfidence(), base: 260, current: 260 }
    state = recordCheck(state, { id: 'old-change', day: boundary - 1, trigger: 'adjustment', notes: '', modifier: 0, change: 20 })
    expect(state.current).toBe(280)
    expect(nextReview(calendar, start, state)).toEqual({ year: 1, day: boundary })
    state = recordReview(calendar, start, boundary, state, 1, false, 'review')
    expect(state.checks.at(-1)).toMatchObject({ score: 260, band: 'Average', trigger: 'annual', day: boundary })
    expect(() => recordReview(calendar, start, boundary, state, 1, false, 'duplicate')).toThrow('no longer due')
    const next = yearStart(calendar, 2)
    state = recordCheck(state, { id: 'one-check', day: boundary, trigger: 'other', notes: '', modifier: 9, change: 1 })
    expect(state.checks.at(-1)).toMatchObject({ score: 270, band: 'Steady' })
    expect(state.current).toBe(261)
    state = recordReview(calendar, start, next, state, 2, true, 'skipped')
    expect(state.current).toBe(261)
    expect(state.reviews[1].skipped).toBe(true)
    expect(confidenceBand(269).name).toBe('Average')
  })

  it('draws from eligible table rows and selects without replacement', () => {
    const options = eventOptions().slice(0, 4).map((item, index) => ({ ...item, enabled: index !== 3, chance: index === 2 ? 0 : 100 }))
    const calls: number[] = []
    const result = drawEvents(options, 1, sides => { calls.push(sides); return 1 })
    expect(calls).toEqual([100, 100, 100, 2])
    expect(result.rolls).toHaveLength(3)
    expect(result.selected).toEqual([options[1].key])
    expect(drawEvents(options, 4, () => 1).selected).toHaveLength(2)
    expect(drawEvents(options.map(item => ({ ...item, enabled: false })), 2, () => { throw Error('Unexpected roll') })).toEqual({ rolls: [], selected: [] })
  })

  it('posts a festival disaster effect once, recalculates estimates, and asks for fresh application on replay', () => {
    const cal = greyhawk()
    const month = { year: 0, period: 'period-6' }
    const festival = dateIndex(cal, { year: 0, period: 'period-5', day: 2 })
    let confidence = recordCheck(initialConfidence(), { id: 'check', day: festival, trigger: 'disaster',
      eventId: 'event', notes: '', modifier: -3, change: 0 })
    confidence = { ...confidence,
      events: [{ id: 'event', day: festival, status: 'resolved', disaster: true, title: 'Earthquake', notes: '', resolvedDay: festival }],
      effects: [{ id: 'effect', source: 'check', title: 'Lost harvest', target: month, category: 'resource', balance: 'noncash', amount: -1000 }],
    }
    const holding: Holding = { id: 'h', name: 'Hold', ruler: 'GM', liege: 'Count', first: month,
      families: 100, services: 1000, tax: 100, resources: [{ name: 'Crops', type: 'vegetable' }],
      opening: { cash: 0, noncash: 0 }, turns: [], replay: [], xpMode: 'pc', confidence }
    const close = closingDay(cal, month)
    const draft = { ...territoryDefaults(holding), effectIds: ['effect'] }
    const posted = recordTurn(cal, close, holding, month, draft)
    expect(posted.turns[0]).toMatchObject({ gross: 119_000, review: { liege: { suggested: 23_800 }, xp: { suggested: 190 } } })
    expect(dominionEntries([posted], festival, festival + 1)).toHaveLength(1)
    expect(availableEffects(posted, month)).toHaveLength(0)
    expect(() => previewTurn(holding, month, { ...draft, effectIds: ['effect', 'effect'] })).toThrow('no longer available')
    expect(() => recordTurn(cal, close, posted, month, draft)).toThrow('no longer due')
    const reopened = reopenTurn(posted, month)
    expect(reopened.confidence).toEqual(confidence)
    expect(availableEffects(reopened, month)).toHaveLength(1)
    expect(replayInputs(reopened, month).effectIds).toBeUndefined()
    const campaign = newCampaign('Campaign', cal)
    const restored = parseCampaignBackup(exportCampaign({ ...campaign, holdings: [reopened] }))
    expect(restored.holdings?.[0].confidence).toEqual(confidence)
  })

  it('moves event and confidence dates on calendar migration', () => {
    const cal = template()
    const campaign = newCampaign('Campaign', cal)
    const confidence = recordCheck(initialConfidence(), { id: 'c', day: 29, trigger: 'other', notes: '', modifier: 0, change: 1 })
    confidence.events.push({ id: 'e', title: 'Event', day: 29, notes: '', disaster: false, status: 'scheduled' })
    const holding: Holding = { id: 'h', name: 'Hold', ruler: 'GM', liege: '', first: { year: 0, period: 'month-1' },
      families: 1, services: 1000, tax: 100, resources: [], opening: { cash: 0, noncash: 0 }, turns: [], replay: [], confidence }
    const proposed = template()
    proposed.periods[0].days = 28
    const result = migrate({ ...campaign, holdings: [holding] }, proposed)
    expect(result.errors).toHaveLength(0)
    expect(result.campaign.holdings?.[0].confidence?.events[0].day).toBe(27)
    expect(result.campaign.holdings?.[0].confidence?.checks[0].day).toBe(27)
    expect(result.affected).toContainEqual({ before: 29, after: 27 })
  })
})
