import { z } from 'zod'
import { dateIndex, dateParts, movePeriod, type Calendar } from './calendar'

const amount = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const money = amount.min(0)
const label = z.string().trim().min(1).max(120)
export const resourceRates = { animal: 200, vegetable: 100, mineral: 300 }
const resource = z.object({ name: label, type: z.enum(['animal', 'vegetable', 'mineral']), rate: money.optional() })
const territory = z.object({
  id: label, name: label, externalId: z.string().trim().max(120).optional(),
  settlement: z.enum(['civilized', 'borderland', 'wilderness']),
  families: money, resources: z.array(resource),
})
const territoryTurn = territory.extend({
  applyGrowth: z.boolean(), largeRate: z.number().min(1).max(5),
  adjustment: amount, override: money.optional(),
  roll: z.object({ die: z.number().int().min(1).max(10), sign: z.union([z.literal(-1), z.literal(1)]) }).optional(),
}).refine(item => !item.roll || item.adjustment === item.roll.die * item.roll.sign, 'Roll must match the signed adjustment')
const territoryResult = z.object({
  id: label, opening: money, rate: z.number().nonnegative(), suggested: money,
  closing: money, production: money,
})
const uniqueTerritories = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length
export const monthSchema = z.object({ year: amount, period: label })
const balances = z.object({ cash: money, noncash: money })
const line = z.object({ name: z.string().trim().min(1).max(242), balance: z.enum(['cash', 'noncash']), amount })
const inputs = z.object({
  families: money, tax: money, services: money, resources: z.array(resource),
  override: money.optional(), realized: money, adjustments: z.array(line), notes: z.string(), territories: z.array(territoryTurn).min(1).refine(uniqueTerritories).optional(),
})
const receipt = z.object({ month: monthSchema, name: label, ruler: label, liege: z.string(), inputs,
  opening: balances, closing: balances, gross: money, lines: z.array(line), territories: z.array(territoryResult).optional() })
export const holdingSchema = z.object({
  id: label, name: label, ruler: label, liege: z.string(), first: monthSchema, opening: balances,
  families: money, tax: money, services: money, resources: z.array(resource),
  territories: z.array(territory).min(1).refine(uniqueTerritories).optional(),
  turns: z.array(receipt), replay: z.array(z.object({ month: monthSchema, inputs })),
})
export type Territory = z.infer<typeof territory>
export type TerritoryTurn = z.infer<typeof territoryTurn>
export type Holding = z.infer<typeof holdingSchema>
export type TurnInputs = z.infer<typeof inputs>
export type Receipt = z.infer<typeof receipt>
export type TurnMonth = z.infer<typeof monthSchema>
export type LedgerLine = z.infer<typeof line>

export const sameMonth = (a: TurnMonth, b: TurnMonth) => a.year === b.year && a.period === b.period
export function closingDay(cal: Calendar, month: TurnMonth) {
  const period = cal.periods.find(item => item.id === month.period && !item.festival)
  if (!period) throw new Error('Choose a regular month.')
  return dateIndex(cal, { ...month, day: period.days })
}
export function monthAt(cal: Calendar, day: number): TurnMonth {
  let date = dateParts(cal, day)
  while (cal.periods.find(period => period.id === date.period)?.festival) {
    day = movePeriod(cal, day, 1)
    date = dateParts(cal, day)
  }
  return { year: date.year, period: date.period }
}
export const nextMonth = (cal: Calendar, month: TurnMonth) => monthAt(cal, closingDay(cal, month) + 1)
export function dueMonth(cal: Calendar, holding: Holding) {
  const last = holding.turns.at(-1)
  return last ? nextMonth(cal, last.month) : holding.first
}
export const holdingDefaults = ({ families, tax, services, resources }: Holding): TurnInputs =>
  ({ families, tax, services, resources, realized: 0, adjustments: [], notes: '' })
export function territoriesFor(holding: Holding): Territory[] {
  return holding.territories ?? [{
    id: 'original-territory', name: holding.name, settlement: 'wilderness',
    families: holding.families, resources: holding.resources,
  }]
}

export function territoryDefaults(holding: Holding): TurnInputs {
  const applyGrowth = holding.turns.some(turn => turn.territories)
  return {
    ...holdingDefaults(holding),
    territories: territoriesFor(holding).map(item => ({ ...item, applyGrowth, largeRate: 1, adjustment: 0 })),
  }
}

export function replayInputs(holding: Holding, month: TurnMonth): TurnInputs {
  const saved = holding.replay.find(item => sameMonth(item.month, month))?.inputs
  if (!saved) return territoryDefaults(holding)
  // Older drafts keep their original single-unit calculation.
  if (!saved.territories) return saved
  const previous = holding.turns.at(-1)?.territories
  return { ...saved, territories: saved.territories.map(item => ({
    ...item, families: previous?.find(result => result.id === item.id)?.closing ?? item.families, override: undefined,
  })) }
}

export function populationGrowth(families: number, largeRate: number) {
  const rate = families === 0 ? 0 : families <= 100 ? 25 : families <= 200 ? 20
    : families <= 300 ? 15 : families <= 400 ? 10 : families <= 500 ? 5 : largeRate
  return { rate, suggested: Math.floor(families * rate / 100) }
}

export function territoryPopulation(item: TerritoryTurn) {
  const { rate, suggested } = populationGrowth(item.families, item.largeRate)
  const closing = item.override ?? item.families + (item.applyGrowth ? suggested : 0) + item.adjustment
  return { rate, suggested, closing }
}

function calculateTerritory(item: TerritoryTurn) {
  const { rate, suggested, closing } = territoryPopulation(item)
  if (!Number.isSafeInteger(closing) || closing < 0) throw new Error(`${item.name} must have a nonnegative whole closing population.`)
  const resources = item.resources.map(resource => ({
    name: resource.name, amount: money.parse(closing * (resource.rate ?? resourceRates[resource.type])),
  }))
  const production = resources.reduce((sum, resource) => money.parse(sum + resource.amount), 0)
  return { id: item.id, name: item.name, opening: item.families, rate, suggested, closing, production, resources }
}

export function previewTurn(holding: Holding, month: TurnMonth, values: TurnInputs): Receipt {
  const draft = inputs.parse(values)
  draft.resources = draft.resources.map(item => ({ ...item, rate: item.rate ?? resourceRates[item.type] }))
  const opening = holding.turns.at(-1)?.closing ?? holding.opening
  draft.territories = draft.territories?.map(item => ({
    ...item, resources: item.resources.map(resource => ({ ...resource, rate: resource.rate ?? resourceRates[resource.type] })),
  }))
  const territories = draft.territories?.map(calculateTerritory)
  if (territories) draft.families = territories.reduce((sum, item) => money.parse(sum + item.closing), 0)
  const tax = draft.families * draft.tax
  const services = draft.families * draft.services
  const production = territories ? territories.flatMap(item => item.resources.map(resource => ({
    name: `${item.name}: ${resource.name}`, balance: 'noncash' as const, amount: resource.amount,
  }))) : draft.resources.map(item => ({
    name: item.name, balance: 'noncash' as const, amount: draft.families * (item.rate ?? resourceRates[item.type]),
  }))
  const total = draft.override ?? production.reduce((sum, item) => money.parse(sum + item.amount), 0)
  if (draft.realized > total) throw new Error('Resource cash realization exceeds resource production.')
  const lines: LedgerLine[] = [
    { name: 'Cash taxes', balance: 'cash', amount: tax },
    { name: 'Standard services', balance: 'noncash', amount: services },
    ...(draft.override === undefined ? production : [{ name: 'Resource override', balance: 'noncash' as const, amount: total }]),
  ]
  if (draft.realized) lines.push(
    { name: 'Resources realized in cash', balance: 'noncash', amount: -draft.realized },
    { name: 'Resources realized in cash', balance: 'cash', amount: draft.realized },
  )
  lines.push(...draft.adjustments)
  const closing = { ...opening }
  for (const item of lines) closing[item.balance] = amount.parse(closing[item.balance] + amount.parse(item.amount))
  for (const balance of ['cash', 'noncash'] as const) {
    if (closing[balance] < 0) throw new Error(`The ${balance} balance is short by ${formatGp(-closing[balance])}.`)
  }
  return receipt.parse({
    month, name: holding.name, ruler: holding.ruler, liege: holding.liege, inputs: draft,
    opening, closing, gross: tax + services + total, lines, territories,
  })
}

export function recordTurn(cal: Calendar, clock: number, holding: Holding, month: TurnMonth, draft: TurnInputs): Holding {
  if (!sameMonth(dueMonth(cal, holding), month) || closingDay(cal, month) > clock) throw new Error('This turn is no longer due. Refresh the preview.')
  const result = previewTurn(holding, month, draft)
  const territories = result.territories ? territoriesFor(holding).map(item => ({
    ...item, families: result.territories?.find(closing => closing.id === item.id)?.closing ?? item.families,
  })) : holding.territories
  // Legacy replay has no per-territory result, so it cannot change configured territory counts.
  const families = territories ? territories.reduce((sum, item) => money.parse(sum + item.families), 0)
    : result.inputs.families
  return { ...holding, families, territories, turns: [...holding.turns, result],
    replay: holding.replay.filter(item => !sameMonth(item.month, month)) }
}

export function reopenTurn(holding: Holding, month: TurnMonth): Holding {
  const index = holding.turns.findIndex(turn => sameMonth(turn.month, month))
  if (index < 0) throw new Error('This turn has already been reopened.')
  const removed = holding.turns.slice(index)
  return { ...holding, turns: holding.turns.slice(0, index),
    replay: [...removed.map(({ month, inputs }) => ({ month, inputs })), ...holding.replay] }
}

export function formatGp(cp: number) {
  return `${(cp / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`
}

export function validHoldings(cal: Calendar, holdings: Holding[]) {
  if (new Set(holdings.map(item => item.id)).size !== holdings.length) return false
  try {
    return holdings.every(holding => {
      let last = closingDay(cal, holding.first) - 1
      return [...holding.turns, ...holding.replay].every(({ month }) => {
        const day = closingDay(cal, month)
        if (day <= last) return false
        last = day
        return true
      })
    })
  } catch { return false }
}

export function turnEntries(cal: Calendar, holdings: Holding[], from: number, to: number, query = '') {
  const needle = query.trim().toLowerCase()
  return holdings.flatMap(holding => holding.turns.flatMap(turn => {
    const day = closingDay(cal, turn.month)
    const title = `${turn.name} · Domain turn`
    if (day < from || day >= to || ![title, turn.ruler, turn.liege, turn.inputs.notes].some(text => text.toLowerCase().includes(needle))) return []
    return [{ day, title, holdingId: holding.id, month: turn.month }]
  }))
}
