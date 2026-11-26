import { describe, expect, it } from 'vitest'
import { dateIndex } from './calendar'
import { migrate } from './migration'
import { greyhawk } from './presets'
import {
  approveResolution, defaultForce, nextResolutionAction, resolveStep, resolutionModifiers, resolutionState, resolutionSummary,
  storeResolution, type Resolution,
} from './quickResolution'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

function draft(kind: Resolution['kind'], start = 0): Resolution {
  return { id: 'test', title: 'Riverwatch', kind, start, rules: 'DMGR2 chapter 8 v1', steps: [], forces: {
    a: { ...defaultForce('River Guard'), points: kind === 'battle' ? 25 : 150 },
    b: { ...defaultForce('Eastbank'), points: kind === 'battle' ? 50 : 100 },
  } }
}

describe('Castle Guide quick resolution', () => {
  it('checks withdrawal at exactly 40%, then applies pursuit after a failed rally', () => {
    const first = resolveStep(draft('battle'), { kind: 'round', roll: 40 })
    expect(first.steps[0]).toMatchObject({ roll: 40, adjusted: 20, before: { a: { points: 25 }, b: { points: 50 } },
      after: { a: { points: 10 }, b: { points: 45 } } })
    expect(nextResolutionAction(first)).toEqual({ kind: 'morale', actor: 'a' })
    const failed = resolveStep(first, { kind: 'morale', roll: 11 })
    expect(nextResolutionAction(failed)).toEqual({ kind: 'withdrawal', actor: 'a' })
    expect(resolutionState(resolveStep(failed, { kind: 'allow' })).winner).toBe('b')
    const pursuit = resolveStep(failed, { kind: 'pursue' })
    const rally = resolveStep(pursuit, { kind: 'rally', roll: 11 })
    const result = resolveStep(rally, { kind: 'round', roll: 56 })
    expect(result.steps.at(-1)).toMatchObject({ adjusted: 1, winner: 'b', after: { a: { points: 0 }, b: { points: 45 } } })
    const rallied = resolveStep(pursuit, { kind: 'rally', roll: 10 })
    expect(resolutionModifiers(rallied, 0)).not.toContainEqual({ label: 'Pursuit', value: -35 })
  })

  it('uses elapsed siege days and reaches surrender at adjusted 100', () => {
    const start = 37
    const first = resolveStep(draft('siege', start), { kind: 'phase', day: start, roll: 65 })
    expect(first.steps[0]).toMatchObject({ adjusted: 55, after: { a: { points: 120, morale: 10 }, b: { points: 95, morale: 10 } } })
    expect(() => resolveStep(first, { kind: 'phase', day: start - 1, roll: 100 })).toThrow('preceding date')
    const result = resolveStep(first, { kind: 'phase', day: start + 41, roll: 100 })
    expect(result.steps[1]).toMatchObject({ adjusted: 100, results: ['Garrison surrenders'], winner: 'a', day: start + 41 })
  })

  it('rounds losses up and prompts when both siege endings apply', () => {
    const seed = draft('siege')
    seed.forces.a = { ...seed.forces.a, points: 11, morale: 6 }
    seed.forces.b = { ...seed.forces.b, points: 7, morale: 3 }
    const first = resolveStep(seed, { kind: 'phase', day: 0, roll: 50, adjustment: 5 })
    expect(first.steps[0]).toMatchObject({ adjusted: 60, after: { a: { points: 8 }, b: { points: 6 } } })
    expect(nextResolutionAction(first).kind).toBe('adjudicate')
    expect(() => resolveStep(first, { kind: 'phase', roll: 50 })).toThrow('competing outcomes')
    expect(resolutionState(resolveStep(first, { kind: 'finish', winner: 'undecided', note: 'Both sides withdraw' })).winner).toBe('undecided')
  })

  it('resumes a restored draft, replaces its last step, and saves a revised narrative to an engagement', () => {
    const cal = greyhawk()
    const start = dateIndex(cal, { year: 0, period: 'period-2', day: 1 })
    const campaign = newCampaign('Riverwatch', cal, start)
    const first = resolveStep(draft('siege', start), { kind: 'phase', roll: 65, day: start })
    const paused = parseCampaignBackup(exportCampaign(storeResolution(campaign, first)))
    const restored = paused.resolutions![0]
    const undone = { ...restored, steps: restored.steps.slice(0, -1) }
    const completed = resolveStep(undone, { kind: 'phase', day: start + 41, roll: 100 })
    const withResult = storeResolution(paused, completed)
    expect(() => approveResolution(withResult, completed, 'Different result', '')).toThrow('reason')
    const revised = approveResolution(withResult, completed, resolutionSummary(completed), '', undefined, 'The gate was opened.')
    const verified = parseCampaignBackup(exportCampaign(revised))
    expect(verified.current).toBe(campaign.current)
    expect(verified.engagements?.[0]).toMatchObject({ start, end: start + 41, consequences: [] })
    expect(verified.engagements?.[0].outcome).toContain('The gate was opened.')
    expect(verified.resolutions?.[0].steps.map(step => step.roll)).toEqual([100])
    expect(() => resolveStep(verified.resolutions![0], { kind: 'phase', roll: 100 })).toThrow('preserved')
    const next = { ...cal, periods: cal.periods.map(period => period.id === 'period-1' ? { ...period, days: period.days + 1 } : period) }
    const migrated = migrate(verified, next)
    expect(migrated.errors).toEqual([])
    expect(migrated.campaign.resolutions?.[0].steps[0]).toMatchObject({ day: start + 42, roll: 100, adjusted: 100 })
    expect(parseCampaignBackup(exportCampaign(migrated.campaign)).engagements?.[0].end).toBe(start + 42)
  })
})
