import { describe, expect, it } from 'vitest'
import { dateIndex } from './calendar'
import { dragonlance, greyhawk } from './presets'
import { filterPrintEntries, printPeriods, type PrintKind } from './printing'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

describe('calendar printing', () => {
  it('includes both endpoint months and a festival across a year boundary', () => {
    const calendar = greyhawk()
    const first = dateIndex(calendar, { year: 0, period: 'period-16', day: 12 })
    const last = dateIndex(calendar, { year: 1, period: 'period-2', day: 4 })
    const sections = printPeriods(calendar, first, last)
    expect(sections.map(({ title }) => title.split(' · ')[0])).toEqual(['Sunsebb', 'Needfest', 'Fireseek'])
    expect(sections.map(({ from, to }) => to - from)).toEqual([28, 7, 28])
    expect(sections[1].from).toBe(sections[0].to)
    expect(sections[2].from).toBe(sections[1].to)
    expect(() => printPeriods(calendar, last, first)).toThrow('on or after')
  })

  it('filters regular and domain entries independently', () => {
    const kinds: PrintKind[] = ['timed', 'all-day', 'construction', 'dominion', 'turn']
    const entries = kinds.map(kind => ({ key: kind, title: kind, start: 0, end: 1, kind }))
    expect(filterPrintEntries(entries, new Set(['timed', 'turn'])).map(entry => entry.kind)).toEqual(['timed', 'turn'])
    expect(filterPrintEntries(entries, new Set())).toEqual([])
  })

  it('preserves an explicit moon display preference in a campaign backup', () => {
    const campaign = { ...newCampaign('Krynn'), ...dragonlance() }
    expect(parseCampaignBackup(exportCampaign(campaign)).calendar.showMoons).toBeUndefined()
    campaign.calendar.showMoons = false
    expect(parseCampaignBackup(exportCampaign(campaign)).calendar.showMoons).toBe(false)
  })
})
