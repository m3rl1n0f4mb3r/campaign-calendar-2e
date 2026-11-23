import { z } from 'zod'
import { dateIndex, dateParts, type Calendar } from './calendar'
import type { TurnMonth } from './domain'

const id = z.string().min(1).max(120)
const day = z.number().int().min(-10_000_000_000).max(10_000_000_000)
const pace = z.union([z.literal(0), z.literal(1), z.literal(2)])
const month = z.object({ year: z.number().int().safe(), period: id })
const days = z.number().int().positive().max(10_000_000)
const die = z.number().int().min(1).max(100)
const range = z.object({ id, from: day, through: day.optional(), pace, notes: z.string(), reviewId: id.optional() })
const review = z.object({
  id, month, roll: die.optional(), incident: day.optional(), setbackDice: z.array(z.number().int().min(1).max(4)).length(2).optional(),
  extraDays: days.optional(), notes: z.string(),
})
const cost = z.object({
  id, source: id, title: z.string().trim().min(1).max(120), target: month,
  category: z.literal('general'), balance: z.enum(['cash', 'noncash']), amount: z.number().int().safe().negative(),
})
export const projectSchema = z.object({
  id, name: z.string().trim().min(1).max(120), start: day, target: day.optional(), notes: z.string(),
  workWeek: z.number().int().min(1).max(366), workDays: days, budget: z.number().int().safe().nonnegative(),
  workWeekLocked: z.boolean().optional(),
  festivalPace: pace, festivalOverrides: z.array(range), stops: z.array(range),
  progress: z.array(z.object({ day, pace })), reviews: z.array(review), reopened: z.array(review),
  costs: z.array(cost), canceled: day.optional(),
})
export type Project = z.infer<typeof projectSchema>
export type ProjectReview = z.infer<typeof review>
export type WorkPace = z.infer<typeof pace>
export type WorkRange = z.infer<typeof range>

export function newProject(cal: Calendar, start: number): Project {
  return { id: crypto.randomUUID(), name: '', start, notes: '', workWeek: cal.weekdays.length, workDays: cal.weekdays.length, budget: 0,
    festivalPace: 0, festivalOverrides: [], stops: [], progress: [], reviews: [], reopened: [], costs: [] }
}

export function periodSpan(cal: Calendar, month: TurnMonth) {
  const period = cal.periods.find(item => item.id === month.period)
  if (!period) throw new Error('The period was removed.')
  const from = dateIndex(cal, { ...month, day: 1 })
  return { from, through: from + period.days - 1, festival: period.festival }
}

function covers(range: WorkRange, day: number) {
  return range.from <= day && day <= (range.through ?? Infinity)
}

export function workPace(project: Project, day: number, festival: boolean): WorkPace {
  if (day < project.start || (project.canceled !== undefined && day >= project.canceled)) return 0
  const base = festival ? [...project.festivalOverrides].reverse().find(item => covers(item, day))?.pace ?? project.festivalPace : 2
  return project.stops.reduce<WorkPace>((result, stop) =>
    covers(stop, day) && stop.pace < result ? stop.pace : result, base)
}

export function requiredWork(project: Project) {
  return (project.workDays + project.reviews.reduce((sum, item) => sum + (item.extraDays ?? 0), 0)) * 2
}

export function confirmedCompletion(project: Project) {
  let remaining = requiredWork(project)
  for (const entry of [...project.progress].sort((a, b) => a.day - b.day)) {
    remaining -= entry.pace
    if (remaining <= 0) return entry.day
  }
}

export function forecast(cal: Calendar, project: Project): number | undefined {
  const done = confirmedCompletion(project)
  if (done !== undefined || project.canceled !== undefined) return done
  let remaining = requiredWork(project)
  const actual = new Map(project.progress.map(item => [item.day, item.pace]))
  const cuts = [...new Set([
    ...[...project.stops, ...project.festivalOverrides].flatMap(item => item.through === undefined ? [item.from] : [item.from, item.through + 1]),
    ...project.progress.flatMap(item => [item.day, item.day + 1]),
  ])].sort((a, b) => a - b)
  let cut = 0
  let current = project.start
  while (Number.isSafeInteger(current)) {
    while (cuts[cut] <= current) cut++
    const nextCut = cuts[cut] ?? Infinity
    const span = periodSpan(cal, dateParts(cal, current))
    const pace = actual.get(current) ?? workPace(project, current, span.festival)
    const fullStop = !actual.has(current) && project.stops.some(range => range.pace === 0 && covers(range, current))
    if (fullStop && nextCut === Infinity) return undefined
    const next = fullStop ? nextCut : Math.min(nextCut, span.through + 1)
    if (pace) {
      const days = next - current
      if (remaining <= days * pace) return current + Math.ceil(remaining / pace) - 1
      remaining -= days * pace
    }
    current = next
  }
}

export const sameProjectMonth = (a: TurnMonth, b: TurnMonth) => a.year === b.year && a.period === b.period

export function pendingReview(cal: Calendar, project: Project, through: number, end = forecast(cal, project)) {
  if (project.canceled !== undefined || confirmedCompletion(project) !== undefined) return
  const limit = Math.min(through, end ?? through)
  const reviewed = new Set(project.reviews.map(item => `${item.month.year}:${item.month.period}`))
  for (let date = project.start; date <= limit;) {
    const { year, period } = dateParts(cal, date)
    const span = periodSpan(cal, { year, period })
    if (!span.festival && !reviewed.has(`${year}:${period}`)) {
      for (let work = date; work <= Math.min(limit, span.through); work++) {
        if (workPace(project, work, false)) return { month: { year, period }, day: work }
        const stops = project.stops.filter(stop => stop.pace === 0 && covers(stop, work))
        if (stops.length) work = Math.min(limit, span.through, ...stops.map(stop => stop.through ?? Infinity))
      }
    }
    const blocked = project.stops.find(stop => stop.pace === 0 && covers(stop, date) && (stop.through ?? Infinity) >= span.through)
    date = blocked ? (blocked.through ?? Infinity) + 1 : span.through + 1
  }
}

export function recordProjectReview(cal: Calendar, project: Project, clock: number, review: ProjectReview, weatherStop: boolean) {
  const due = pendingReview(cal, project, clock)
  if (!due || !sameProjectMonth(due.month, review.month)) throw new Error('Review the first eligible construction month.')
  const span = periodSpan(cal, review.month)
  if (review.incident !== undefined && (review.incident < Math.max(span.from, project.start) || review.incident > span.through || review.incident > clock)) {
    throw new Error('Choose an incident date in the reviewed month through the campaign date.')
  }
  const stops = weatherStop ? [...project.stops, {
    id: review.id, from: due.day, through: span.through, pace: 0 as const, notes: 'Construction weather stoppage', reviewId: review.id,
  }] : project.stops
  return projectSchema.parse({ ...project, stops, reviews: [...project.reviews, review],
    reopened: project.reopened.filter(item => !sameProjectMonth(item.month, review.month)) })
}

export function* workCandidates(cal: Calendar, project: Project, from: number, through: number, override?: WorkPace) {
  for (let day = from; day <= through; day++) {
    const month = dateParts(cal, day)
    const span = periodSpan(cal, month)
    const pace = override ?? workPace(project, day, span.festival)
    if (pace || override !== undefined) {
      yield { day, pace, month, festival: span.festival }
      continue
    }
    const stop = project.stops.find(stop => stop.pace === 0 && covers(stop, day))
    if (stop) day = Math.min(through, stop.through ?? Infinity)
    else if (span.festival && project.festivalPace === 0) {
      const nextOverride = project.festivalOverrides.find(item => item.pace && item.from > day && item.from <= span.through)
      if (!nextOverride && !project.festivalOverrides.some(item => item.pace && covers(item, day))) day = span.through
    }
  }
}

export function postWork(cal: Calendar, project: Project, clock: number, from: number, through: number, override?: WorkPace) {
  if (project.canceled !== undefined || confirmedCompletion(project) !== undefined || from < project.start || through > clock || from > through || (override === 0 && from !== through)) {
    throw new Error('Choose an active date range through the campaign date. A no-work correction applies to one day at a time.')
  }
  const existing = new Set(project.progress.map(item => item.day))
  let remaining = requiredWork(project) - project.progress.reduce((sum, item) => sum + item.pace, 0)
  const next = [...project.progress]
  for (const { day, pace, month, festival } of workCandidates(cal, project, from, through, override)) {
    if (remaining <= 0) break
    if (existing.has(day)) {
      if (override === undefined) continue
      throw new Error('Reopen an approved date before replacing its progress.')
    }
    if (!festival && !project.reviews.some(item => sameProjectMonth(item.month, month))) {
      throw new Error('Record or skip the construction review before approving regular-month work.')
    }
    const credit = Math.min(remaining, pace) as WorkPace
    next.push({ day, pace: credit })
    remaining -= credit
  }
  return projectSchema.parse({
    ...project, workWeekLocked: project.workWeekLocked || next.length > 0 || undefined,
    progress: next.sort((a, b) => a.day - b.day),
  })
}

export function reopenProjectReview(cal: Calendar, project: Project, month: TurnMonth) {
  const { from } = periodSpan(cal, month)
  const removed = project.reviews.filter(item => periodSpan(cal, item.month).from >= from)
  const ids = new Set(removed.map(item => item.id))
  return { ...project, reviews: project.reviews.filter(item => !ids.has(item.id)),
    reopened: [...removed, ...project.reopened], progress: project.progress.filter(item => item.day < from),
    stops: project.stops.filter(item => !item.reviewId || !ids.has(item.reviewId)) }
}

export function validProjects(cal: Calendar, projects: Project[]) {
  const unique = (ids: (number | string)[]) => new Set(ids).size === ids.length
  return unique(projects.map(item => item.id)) && projects.every(project => {
    const reviewMonths = [...project.reviews, ...project.reopened].map(item => item.month)
    return unique(project.progress.map(item => item.day)) && unique(reviewMonths.map(item => periodSpan(cal, item).from))
      && reviewMonths.every(item => !periodSpan(cal, item).festival)
      && project.progress.every(item => item.day >= project.start)
      && [...project.stops, ...project.festivalOverrides].every(item => item.through === undefined || item.from <= item.through)
      && (project.target === undefined || project.target >= project.start)
  })
}

const outcomes = [
  [65, 'No unusual event', 'Review work at the scheduled pace.'],
  [75, 'Bad weather', 'Offer a full stop for the remaining uncredited work in the month.'],
  [81, 'Severe weather', 'Offer a work stoppage and roll 2d4 weeks of additional work.'],
  [83, 'Monster attack', 'Review losses, funeral costs, and a pause until the threat is dealt with.'],
  [85, 'Highwaymen', 'Consider half speed until the supply routes are clear.'],
  [87, 'Local unrest', 'Consider a 1d4-week stoppage and half speed if the dispute continues.'],
  [89, 'Labor dispute', 'Decide how the workforce dispute affects work and costs.'],
  [91, 'Raid', 'Resolve the raid at the table, then record approved delays or expenses.'],
  [93, 'Call to arms', 'Review availability of workers and revised project timing.'],
  [95, 'Civil war', 'Review disruption, safety, and work availability.'],
  [97, 'Royal visit', 'Review hospitality costs and disruption.'],
  [99, 'Bad omens', 'Decide whether the crew pauses work or continues.'],
  [100, 'Natural disaster', 'Assess damage, work lost, and any extra costs.'],
] as const
export function constructionOutcome(roll: number) {
  const [, title, guidance] = outcomes.find(([maximum]) => roll <= maximum) ?? outcomes.at(-1)!
  return { title, guidance }
}
