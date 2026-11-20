import { describe, expect, it } from 'vitest'
import { dateIndex, dateParts, moonColor, moonPhase, phaseNames, template, weekday, yearLabel, yearLength } from './calendar'
import { changeSeries, minutes, occurrences, type Series } from './events'
import { migrate } from './migration'
import { dragonlance, greyhawk } from './presets'
import { deleteActiveCampaign, exportCampaign, newCampaign, parseCampaignBackup, parseStore, restoreActiveCampaign, saveStore, type Store } from './storage'

const event = (day: number, changes: Partial<Series> = {}): Series => ({
  title: 'Trade caravan', location: 'East gate', notes: 'Escorted', color: '#52745e',
  id: 'event', start: day * minutes, end: (day + 1) * minutes, allDay: true, exceptions: {}, ...changes,
})

describe('campaign dates', () => {
  it('crosses the era boundary without displaying a year zero', () => {
    const calendar = template()
    expect(dateParts(calendar, -1)).toEqual({ year: -1, period: 'month-12', day: 30 })
    expect(dateParts(calendar, 0)).toEqual({ year: 0, period: 'month-1', day: 1 })
    expect(yearLabel(calendar, 0)).toBe('1')
    expect(dateIndex(calendar, dateParts(calendar, -361))).toBe(-361)
  })

  it('counts all four Greyhawk festivals in elapsed days and weekdays', () => {
    const calendar = greyhawk()
    expect(yearLength(calendar)).toBe(364)
    expect(calendar.periods.filter(p => !p.festival)).toHaveLength(12)
    const before = dateIndex(calendar, { year: 0, period: 'period-4', day: 28 })
    expect(dateParts(calendar, before + 1)).toEqual({ year: 0, period: 'period-5', day: 1 })
    expect(dateParts(calendar, before + 8)).toEqual({ year: 0, period: 'period-6', day: 1 })
    expect(weekday(calendar, before + 1)).toBe(weekday(calendar, before + 8))
    expect(moonPhase({ name: 'Test moon', anchor: before + 1, cycle: 14, phase: 4, source: 'Test' }, before + 8)).toBe(0)
  })

  it('tracks the three Tales of the Lance cycles from explicit sample anchors', () => {
    const { calendar, current } = dragonlance()
    const phasesOn = (offset: number) => calendar.moons.map(moon => phaseNames[moonPhase(moon, current + offset)])
    expect(phasesOn(-4)).toEqual(['Waxing gibbous', 'Waxing gibbous', 'New moon'])
    expect(phasesOn(0)).toEqual(['Full moon', 'Full moon', 'Full moon'])
    expect(phasesOn(3)).toEqual(['Waning gibbous', 'Waning gibbous', 'Waning crescent'])
    expect(phasesOn(4)).toEqual(['Waning gibbous', 'Waning gibbous', 'New moon'])
    for (const moon of calendar.moons) {
      expect(moonPhase(moon, current + moon.cycle / 2)).toBe(0)
      expect(moonPhase(moon, current + moon.cycle)).toBe(4)
      expect(moonPhase(moon, current - moon.cycle)).toBe(4)
    }
  })
})

describe('events', () => {
  it('uses an exclusive end and finds a span across the year boundary', () => {
    const calendar = template()
    const span = event(-1, { end: 2 * minutes })
    expect(occurrences(calendar, [span], 0, 1)).toHaveLength(1)
    expect(occurrences(calendar, [span], 2, 3)).toHaveLength(0)
  })

  it('supports each festival recurrence choice across years', () => {
    const calendar = greyhawk()
    const origin = 2
    const starts = (festival: 'previous' | 'next' | 'festival') => occurrences(calendar, [event(origin, {
      rule: { frequency: 'yearly', interval: 1, weekdays: [], festival, count: 2 },
    })], 0, 730).map(item => item.start / minutes)
    expect(starts('previous')).toEqual([2, 363])
    expect(starts('next')).toEqual([2, 7])
    expect(starts('festival')).toEqual([2, 366])
  })

  it('skips festivals and nonexistent dates when repeating monthly', () => {
    const calendar = greyhawk()
    calendar.periods[5].days = 21
    const start = dateIndex(calendar, { year: 0, period: 'period-4', day: 28 })
    const found = occurrences(calendar, [event(start, {
      rule: { frequency: 'monthly', interval: 1, weekdays: [], festival: 'previous', count: 2 },
    })], start, start + 100)
    expect(found.map(item => dateParts(calendar, item.start / minutes).period)).toEqual(['period-4', 'period-7'])
  })

  it('finds a moved occurrence by content and keeps earlier dates when splitting', () => {
    const calendar = template()
    const series = event(0, { rule: { frequency: 'daily', interval: 1, weekdays: [], count: 5, festival: 'previous' } })
    const [, second, third] = occurrences(calendar, [series], 0, 10)
    const edited = changeSeries([series], second, 'one', { ...second, start: 9 * minutes, end: 10 * minutes, title: 'Changed' })
    expect(occurrences(calendar, edited, 9, 10, 'changed')).toHaveLength(1)
    const split = changeSeries(edited, third, 'future', { ...third, title: 'Future' }, series.rule)
    expect(occurrences(calendar, split, 0, 10).map(item => item.title)).toEqual(['Trade caravan', 'Future', 'Future', 'Future', 'Changed'])
  })

  it('preserves count when viewing a distant weekly window', () => {
    const calendar = template()
    const series = event(0, { rule: { frequency: 'weekly', interval: 1, weekdays: [0, 2], count: 8, festival: 'previous' } })
    expect(occurrences(calendar, [series], 21, 30).map(item => item.ordinal)).toEqual([7, 8])
    expect(occurrences(calendar, [series], 30, 50)).toHaveLength(0)
  })
})

describe('migration and storage', () => {
  it('deletes only the active campaign and opens a remaining campaign', () => {
    const first = newCampaign('First')
    const removed = newCampaign('Remove this')
    const last = newCampaign('Last', greyhawk(), 31)
    last.events = [event(31)]
    const store: Store = { version: 1, active: removed.id, campaigns: [first, removed, last] }
    const next = deleteActiveCampaign(store)
    expect(next.active).toBe(first.id)
    expect(next.campaigns).toEqual([first, last])
    expect(store.campaigns).toHaveLength(3)
  })

  it('replaces the last deleted campaign with an empty starter', () => {
    const campaign = newCampaign('Remove this')
    campaign.events = [event(4)]
    const next = deleteActiveCampaign({ version: 1, active: campaign.id, campaigns: [campaign] })
    expect(next.campaigns).toHaveLength(1)
    expect(next.campaigns[0]).toMatchObject({ id: next.active, name: 'Example Campaign', events: [] })
    expect(next.active).not.toBe(campaign.id)
  })

  it('round-trips a custom moon color and supplies a default for an older moon record', () => {
    const { calendar, current } = dragonlance()
    const older = parseCampaignBackup(exportCampaign(newCampaign('Krynn', calendar, current)))
    expect(moonColor(older.calendar.moons[0], 0)).toBe('#697681')
    older.calendar.moons[0].color = '#845a30'
    const restored = parseCampaignBackup(exportCampaign(older))
    expect(moonColor(restored.calendar.moons[0], 0)).toBe('#845a30')
  })

  it('exports one campaign and restores into the active slot even when the source ID belongs to another campaign', () => {
    const target = newCampaign('Target')
    const source = newCampaign('Source', greyhawk(), 12)
    source.events = [event(12)]
    const store: Store = { version: 1, active: target.id, campaigns: [source, target] }
    const file = exportCampaign(source)
    expect(JSON.parse(file)).toEqual({ version: 1, campaign: source })
    const restored = restoreActiveCampaign(store, parseCampaignBackup(file))
    expect(restored.active).toBe(target.id)
    expect(restored.campaigns).toEqual([source, { ...source, id: target.id }])
    expect(store.campaigns[1]).toEqual(target)
  })

  it('reads the saved active campaign from a legacy backup and rejects malformed campaign backups', () => {
    const first = newCampaign('First')
    const second = newCampaign('Second')
    expect(parseCampaignBackup(JSON.stringify({ version: 1, active: second.id, campaigns: [first, second] }))).toEqual(second)
    expect(() => parseCampaignBackup(JSON.stringify({ version: 1, campaign: { ...first, current: 'invalid' } }))).toThrow()
  })

  it('previews date clamping and preserves an all-day event on its last valid day', () => {
    const campaign = newCampaign('Campaign')
    campaign.current = 29
    campaign.events = [event(29)]
    const next = template()
    next.periods[0].days = 25
    const preview = migrate(campaign, next)
    expect(preview.errors).toEqual([])
    expect(preview.campaign.current).toBe(24)
    expect(preview.affected).toContainEqual({ before: 29, after: 24 })
    expect(preview.campaign.events[0].end).toBe(25 * minutes)
    expect(preview.changes.some(line => line.includes('Campaign clock'))).toBe(true)
    expect(campaign.current).toBe(29)
  })

  it('blocks overlapping recurrence exceptions after shortening a month', () => {
    const campaign = newCampaign('Campaign')
    campaign.events = [event(0, {
      rule: { frequency: 'daily', interval: 1, weekdays: [], festival: 'previous' },
      exceptions: { [28 * minutes]: null, [29 * minutes]: null },
    })]
    const next = template()
    next.periods[0].days = 25
    expect(migrate(campaign, next).errors.join()).toContain('overlapping recurrence exceptions')
  })

  it('validates backup data before writing', () => {
    const campaign = newCampaign('Campaign')
    const store: Store = { version: 1, active: campaign.id, campaigns: [campaign] }
    let value = ''
    const storage = { setItem: (_key: string, data: string) => { value = data } } as Storage
    saveStore(storage, store)
    expect(parseStore(value)).toEqual(store)
    expect(() => saveStore(storage, { ...store, active: 'missing' })).toThrow()
    expect(parseStore(value)).toEqual(store)
  })
})
