import { z } from 'zod'
import { dateIndex, dateParts, type Calendar } from './calendar'

const id = z.string().min(1).max(120)
const integer = z.number().int().safe()
const score = z.number().int().min(1).max(500)
const day = integer.min(-10_000_000_000).max(10_000_000_000)
export const triggerLabels = {
  annual: 'Annual review', celebration: 'Missed celebration', disaster: 'Natural disaster',
  enemy: 'Enemy forces entered the holding', other: 'GM check', adjustment: 'Monthly adjustment',
}
export const effectCategories = { tax: 'Taxes', services: 'Services', resource: 'Resource income', general: 'Other ledger adjustment' }
const reason = z.string().trim().min(1).max(120)
const check = z.object({
  id, day, trigger: z.enum(['annual', 'celebration', 'disaster', 'enemy', 'other', 'adjustment']),
  notes: z.string(), eventId: id.optional(), modifier: integer, change: integer, score, band: id,
})
const annual = z.object({ year: integer, day, skipped: z.boolean(), checkId: id.optional() })
const event = z.object({
  id, title: reason, day, notes: z.string(), disaster: z.boolean(),
  status: z.enum(['scheduled', 'resolved', 'dismissed', 'removed']), resolvedDay: day.optional(),
})
const effect = z.object({
  id, source: id, title: reason, target: z.object({ year: integer, period: id }),
  category: z.enum(['tax', 'services', 'resource', 'general']),
  balance: z.enum(['cash', 'noncash']), amount: integer,
})
const eventOption = z.object({
  key: id, title: reason, group: z.enum(['Natural', 'Unnatural']),
  chance: z.number().min(0).max(100), disaster: z.boolean(), enabled: z.boolean(),
})
const roll = z.object({ key: id, title: reason.optional(), chance: z.number().min(0).max(100), result: z.number().int().min(1).max(100) })
export const confidenceSchema = z.object({
  start: day.optional(),
  base: score, current: score,
  baseRoll: z.object({ die: z.number().int().min(1).max(100), abilities: z.array(z.number().int().min(1).max(25)).length(6) }).optional(),
  reviews: z.array(annual), checks: z.array(check), events: z.array(event), effects: z.array(effect),
  eventOptions: z.array(eventOption).optional(),
  draws: z.array(z.object({ year: integer, target: z.number().int().min(1).max(4), rolls: z.array(roll), selected: z.array(id) })),
})
export type Confidence = z.infer<typeof confidenceSchema>
export type ConfidenceCheck = z.infer<typeof check>
export type DominionEvent = z.infer<typeof event>
export type DomainEffect = z.infer<typeof effect>

export const initialConfidence = (): Confidence => ({ base: 250, current: 250, reviews: [], checks: [], events: [], effects: [], draws: [] })
export const clampConfidence = (value: number) => Math.max(1, Math.min(500, value))
const bands = [
  [450, 'Ideal', '10% higher income. Review spy discovery, disaster avoidance, and bonuses for the next check.'],
  [400, 'Thriving', '10% higher income. Review spy discovery and disaster avoidance.'],
  [350, 'Prosperous', '10% higher income. Review spy discovery and disaster avoidance.'],
  [300, 'Healthy', '10% higher income. Review possible spy discovery.'],
  [270, 'Steady', 'Review possible spy discovery.'], [230, 'Average', 'No special consequences.'],
  [200, 'Unsteady', 'Review the 1-in-6 chance of a 10% confidence drop.'],
  [150, 'Defiant', 'Review reduced service and resource income and possible militia activity.'],
  [100, 'Rebellious', 'Review reduced service and resource income and the recurring confidence penalty.'],
  [50, 'Belligerent', 'Review severe income reductions, hostile activity, and the recurring confidence penalty.'],
  [1, 'Turbulent', 'Review loss of income, open revolt, and restrictions on confidence recovery.'],
] as const
export function confidenceBand(value: number) {
  const [, name, guidance] = bands.find(([minimum]) => clampConfidence(value) >= minimum)!
  return { name, guidance }
}

export function yearStart(cal: Calendar, year: number) {
  return dateIndex(cal, { year, period: cal.periods[0].id, day: 1 })
}
export function nextReview(cal: Calendar, start: number, state: Confidence) {
  const date = dateParts(cal, state.start ?? start)
  const first = yearStart(cal, date.year)
  let year = date.year + Number((state.start ?? start) > first)
  const completed = new Set(state.reviews.map(item => item.year))
  while (completed.has(year)) year++
  return { year, day: yearStart(cal, year) }
}

export function confidenceAt(state: Confidence, at = Infinity) {
  const entries = state.checks.filter(item => item.day <= at)
    .sort((a, b) => a.day - b.day || Number(b.trigger === 'annual') - Number(a.trigger === 'annual'))
  return entries.reduce((value, item) => item.trigger === 'annual' ? item.score : clampConfidence(value + item.change), state.base)
}

export function recordCheck(state: Confidence, input: Omit<ConfidenceCheck, 'score' | 'band'>, reset = false): Confidence {
  const start = reset ? state.base : confidenceAt(state, input.day)
  const current = clampConfidence(start + input.change)
  const effective = clampConfidence(current + input.modifier)
  const result = check.parse({ ...input, score: effective, band: confidenceBand(effective).name })
  const next = { ...state, checks: [...state.checks, result] }
  return { ...next, current: confidenceAt(next) }
}
export function recordReview(cal: Calendar, start: number, current: number, state: Confidence, year: number, skip: boolean, checkId: string) {
  const next = nextReview(cal, start, state)
  if (next.year !== year || next.day > current) throw new Error('This annual review is no longer due.')
  const result = skip ? state : recordCheck(state, {
    id: checkId, day: next.day, trigger: 'annual', notes: '', modifier: 0, change: 0,
  }, true)
  return { ...result, reviews: [...state.reviews, { ...next, skipped: skip, checkId: skip ? undefined : checkId }] }
}

export type EventOption = z.infer<typeof eventOption>
const natural: [string, number, boolean?][] = [
  ['Comet', 30], ['Death of an official', 10], ['Earthquake', 10, true], ['Explosion', 10],
  ['Minor fire', 50], ['Major fire', 10, true], ['Flood', 10], ['Hurricane', 15, true],
  ['Market glut', 20], ['Market shortage', 25], ['Major meteor strike', 1, true], ['Minor meteor shower', 20],
  ['Plague', 25, true], ['Population change', 20], ['Resource lost', 10], ['New resource', 10],
  ['Sinkhole', 5], ['Storm', 80], ['Tornado', 25, true], ['Trade route lost', 15], ['New trade route', 15],
  ['Volcano', 2, true], ['Waterspout', 25], ['Whirlpool', 25],
]
const unnatural: [string, number][] = [
  ['Assassination', 10], ['Bandits', 50], ['Birth in ruling family', 20], ['Border skirmish', 40],
  ['Cultural discovery', 10], ['Fanatic cult', 10], ['Insurrection', 10], ['Lycanthropy', 15],
  ['Magical happening', 30], ['Migration', 10], ['Pretender', 10], ['Raiders', 25],
  ['Minor rebellion', 10], ['New resident specialist', 20], ['Spy ring', 60], ['Traitor', 30],
  ['Accidental death of an official', 25], ['VIP visitor', 10], ['Powerful wandering monsters', 75],
]
export function eventOptions(): EventOption[] {
  return ([['Natural', natural], ['Unnatural', unnatural]] as const).flatMap(([group, rows]) =>
    rows.map(([title, chance, disaster], index) => ({ key: `${group}-${index}`, title, group, chance, disaster: !!disaster, enabled: true })))
}
export const rollDie = (sides: number) => 1 + Math.floor(Math.random() * sides)
export function drawEvents(options: EventOption[], target: number, die = rollDie) {
  const rolls = options.filter(option => option.enabled).map(({ key, title, chance }) => ({ key, title, chance, result: die(100) }))
  const matches = rolls.filter(item => item.result <= item.chance).map(item => item.key)
  while (matches.length > target) matches.splice(die(matches.length) - 1, 1)
  return { rolls, selected: matches }
}
