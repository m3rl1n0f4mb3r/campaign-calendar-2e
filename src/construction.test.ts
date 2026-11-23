import { describe, expect, it } from 'vitest'
import { dateIndex, template } from './calendar'
import {
  confirmedCompletion, constructionOutcome, forecast, newProject, pendingReview, postWork,
  recordProjectReview, reopenProjectReview, requiredWork,
} from './construction'
import { availableEffects, closingDay, constructionEntries, recordTurn, reopenTurn, replayInputs, territoryDefaults, type Holding } from './domain'
import { migrate } from './migration'
import { greyhawk } from './presets'
import { exportCampaign, newCampaign, parseCampaignBackup } from './storage'

describe('construction projects', () => {
  it('uses named weekdays, excludes festival work by default, and supports half/full overrides', () => {
    const cal = greyhawk()
    const start = dateIndex(cal, { year: 0, period: 'period-5', day: 1 })
    const planting = start + 7
    const project = { ...newProject(cal, start), name: 'Gatehouse' }
    expect(project.workWeek).toBe(7)
    expect(forecast(cal, project)).toBe(planting + 6)
    expect(forecast(cal, { ...project, festivalPace: 1 })).toBe(planting + 3)
    const full = { ...project, festivalOverrides: [{ id: 'festival-work', from: start, through: start + 6, pace: 2 as const, notes: '' }] }
    expect(pendingReview(cal, full, planting + 5)).toBeUndefined()
    const complete = postWork(cal, full, start + 6, start, start + 6)
    expect(confirmedCompletion(complete)).toBe(start + 6)
    const ten = { ...template(), weekdays: Array.from({ length: 10 }, (_, index) => String(index + 1)) }
    expect(forecast(ten, newProject(ten, 0))).toBe(9)
    expect(forecast(ten, { ...newProject(ten, 0), workWeek: 7, workDays: 7 })).toBe(6)
  })

  it('requires each regular-month review once and combines overlapping weather stops', () => {
    const cal = template()
    const project = { ...newProject(cal, 0), name: 'Keep', workDays: 42 }
    const month = { year: 0, period: cal.periods[0].id }
    expect(pendingReview(cal, project, -1)).toBeUndefined()
    expect(pendingReview(cal, project, 0)).toEqual({ month, day: 0 })
    expect(() => postWork(cal, project, 0, 0, 0)).toThrow('Record or skip')
    expect(constructionOutcome(70).title).toBe('Bad weather')
    const stopped = recordProjectReview(cal, project, 0, { id: 'review', month, roll: 70, notes: '', incident: 0 }, true)
    expect(forecast(cal, stopped)).toBe(71)
    expect(postWork(cal, stopped, 29, 0, 29).progress).toHaveLength(0)
    const overlap = { ...stopped, stops: [...stopped.stops, { id: 'stop', from: 10, through: 20, pace: 0 as const, notes: '' }] }
    expect(forecast(cal, overlap)).toBe(71)
    expect(pendingReview(cal, overlap, 30)?.day).toBe(30)
    expect(() => recordProjectReview(cal, stopped, 29, { id: 'duplicate', month, notes: '' }, false)).toThrow('first eligible')
    const severe = recordProjectReview(cal, project, 0, { id: 'severe', month, roll: 76, notes: '', setbackDice: [2, 3], extraDays: 35 }, true)
    expect(requiredWork(severe) - requiredWork(project)).toBe(70)
    expect(forecast(cal, severe)).toBe(106)
  })

  it('pauses an open-ended forecast and replaces reopened work without double-crediting dates', () => {
    const cal = template()
    const project = { ...newProject(cal, 0), name: 'Wall',
      stops: [{ id: 'stop', from: 2, pace: 0 as const, notes: '' }] }
    const month = { year: 0, period: cal.periods[0].id }
    expect(forecast(cal, project)).toBeUndefined()
    const checked = recordProjectReview(cal, project, 4, { id: 'check', month, notes: '' }, false)
    const work = postWork(cal, checked, 4, 0, 0, 1)
    expect(postWork(cal, work, 4, 0, 0).progress).toEqual(work.progress)
    expect(() => postWork(cal, work, 4, 0, 0, 2)).toThrow('Reopen')
    const reopened = reopenProjectReview(cal, work, month)
    expect(reopened.progress).toHaveLength(0)
    expect(reopened.stops).toEqual(project.stops)
    expect(reopened.reopened[0].id).toBe('check')
    const restored = recordProjectReview(cal, reopened, 4, { id: 'check', month, notes: '' }, false)
    expect(postWork(cal, restored, 4, 0, 0, 2).progress).toEqual([{ day: 0, pace: 2 }])
    expect(() => postWork(cal, restored, 4, 5, 5, 2)).toThrow('campaign date')
  })

  it('posts staged progress and project costs with the turn and keeps project history when the turn reopens', () => {
    const cal = template()
    const month = { year: 0, period: cal.periods[0].id }
    const project = { ...newProject(cal, 0), name: 'Keep', workDays: 30, budget: 25_000 }
    const clock = closingDay(cal, month)
    const reviewed = recordProjectReview(cal, project, clock, { id: 'check', month, notes: '', roll: 66 }, false)
    const worked = postWork(cal, reviewed, clock, 0, 7)
    const cost = { id: 'cost', source: 'check', title: 'Timber', target: month, balance: 'cash' as const, category: 'general' as const, amount: -12_550 }
    const holding: Holding = { id: 'holding', name: 'Holding', ruler: 'Ruler', liege: '', first: month, families: 0,
      tax: 100, services: 1000, resources: [], opening: { cash: 50_000, noncash: 0 }, turns: [], replay: [],
      projects: [{ ...worked, costs: [cost] }],
    }
    const posted = recordTurn(cal, clock, holding, month, { ...territoryDefaults(holding), effectIds: ['cost'] })
    expect(posted.projects?.[0].progress).toHaveLength(8)
    expect(posted.turns[0].closing.cash).toBe(37_450)
    expect(posted.turns[0].lines.filter(line => line.effectId === 'cost')).toHaveLength(1)
    expect(availableEffects(posted, month)).toHaveLength(0)
    const reopened = reopenTurn(posted, month)
    expect(reopened.projects).toEqual(posted.projects)
    expect(replayInputs(reopened, month).effectIds).toBeUndefined()
    expect(availableEffects(reopened, month)).toEqual([cost])
    const campaign = newCampaign('Campaign', cal)
    const restored = parseCampaignBackup(exportCampaign({ ...campaign, holdings: [posted] }))
    expect(restored.holdings?.[0].projects).toEqual(posted.projects)
    expect(constructionEntries(cal, [holding], 0, 61).map(entry => entry.title)).toContain('Keep · Construction forecast')
  })

  it('previews migrated construction dates and rejects collapsed work days', () => {
    const calendar = template()
    const campaign = newCampaign('Campaign', calendar)
    const month = { year: 0, period: calendar.periods[0].id }
    const project = { ...newProject(calendar, 0), name: 'Castle', target: 29, workDays: 40 }
    const holding: Holding = {
      id: 'holding', name: 'Holding', ruler: 'Ruler', liege: '', first: month, families: 0, tax: 100,
      services: 1000, resources: [], opening: { cash: 0, noncash: 0 }, turns: [], replay: [], projects: [project],
    }
    const next = template()
    next.periods[0].days = 28
    const preview = migrate({ ...campaign, holdings: [holding] }, next)
    expect(preview.errors).toHaveLength(0)
    expect(preview.campaign.holdings?.[0].projects?.[0].target).toBe(27)
    expect(preview.affected).toContainEqual({ before: 29, after: 27 })
    const reviewed = recordProjectReview(calendar, project, 29, { id: 'review', month, notes: '' }, false)
    const worked = postWork(calendar, reviewed, 29, 28, 29)
    expect(migrate({ ...campaign, holdings: [{ ...holding, projects: [worked] }] }, next).errors.join()).toContain('overlapping')
  })
})
