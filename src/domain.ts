import { z } from 'zod'
import { dateIndex, dateParts, movePeriod, type Calendar } from './calendar'

const amount = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const money = amount.min(0)
const label = z.string().trim().min(1).max(120)
export const resourceRates = { animal: 200, vegetable: 100, mineral: 300 }
const resource = z.object({ name: label, type: z.enum(['animal', 'vegetable', 'mineral']), rate: money.optional() })
export const monthSchema = z.object({ year: amount, period: label })
const balances = z.object({ cash: money, noncash: money })
const line = z.object({ name: label, balance: z.enum(['cash', 'noncash']), amount })
const inputs = z.object({
  families: money, tax: money, services: money, resources: z.array(resource),
  override: money.optional(), realized: money, adjustments: z.array(line), notes: z.string(),
})
const receipt = z.object({ month: monthSchema, name: label, ruler: label, liege: z.string(), inputs,
  opening: balances, closing: balances, gross: money, lines: z.array(line) })
export const holdingSchema = z.object({
  id: label, name: label, ruler: label, liege: z.string(), first: monthSchema, opening: balances,
  families: money, tax: money, services: money, resources: z.array(resource),
  turns: z.array(receipt), replay: z.array(z.object({ month: monthSchema, inputs })),
})
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
export const replayInputs = (holding: Holding, month: TurnMonth) =>
  holding.replay.find(item => sameMonth(item.month, month))?.inputs ?? holdingDefaults(holding)

export function previewTurn(holding: Holding, month: TurnMonth, values: TurnInputs): Receipt {
  const draft = inputs.parse(values)
  const opening = holding.turns.at(-1)?.closing ?? holding.opening
  const tax = draft.families * draft.tax
  const services = draft.families * draft.services
  const production = draft.resources.map(item => ({
    name: item.name, balance: 'noncash' as const, amount: draft.families * (item.rate ?? resourceRates[item.type]),
  }))
  const total = draft.override ?? production.reduce((sum, item) => sum + item.amount, 0)
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
  for (const item of lines) closing[item.balance] += item.amount
  for (const balance of ['cash', 'noncash'] as const) {
    if (closing[balance] < 0) throw new Error(`The ${balance} balance is short by ${formatGp(-closing[balance])}.`)
  }
  return receipt.parse({
    month, name: holding.name, ruler: holding.ruler, liege: holding.liege, inputs: draft,
    opening, closing, gross: tax + services + total, lines,
  })
}

export function recordTurn(cal: Calendar, clock: number, holding: Holding, month: TurnMonth, draft: TurnInputs): Holding {
  if (!sameMonth(dueMonth(cal, holding), month) || closingDay(cal, month) > clock) throw new Error('This turn is no longer due. Refresh the preview.')
  const result = previewTurn(holding, month, draft)
  return { ...holding, families: result.inputs.families, turns: [...holding.turns, result],
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
