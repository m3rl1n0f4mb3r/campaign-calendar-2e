import { militaryChargeState, militaryInputsSchema, militarySchema, validMilitary, validateMilitaryTurn } from './military'
import { confirmedCompletion, constructionOutcome, forecast, projectSchema, validProjects } from './construction'
import { z } from 'zod'
import { dateIndex, dateParts, movePeriod, type Calendar } from './calendar'
import { confidenceSchema, type DomainEffect } from './confidence'

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
export const paymentLabels = { liege: 'Liege payment', tithe: 'Tithe' }
export type PaymentKind = keyof typeof paymentLabels
const category = z.enum(['tribute', 'liege', 'tithe'])
const line = z.object({ name: z.string().trim().min(1).max(242), balance: z.enum(['cash', 'noncash']), amount, category: category.optional(), effectId: label.optional() })
const rate = z.number().int().min(0).max(10_000)
const payment = z.object({ rate, cash: money, noncash: money, includeTribute: z.boolean(), approved: z.boolean() })
const xpMode = z.enum(['pc', 'npc', 'off'])
const xpDecision = z.object({ mode: z.enum(['pc', 'npc']), recipient: label, override: money.optional(), approved: z.boolean() })
const award = z.object({ recipient: label, amount: money })
const estimation = z.object({ basis: money, suggested: money, rate, manual: money })
const review = z.object({ liege: estimation.optional(), tithe: estimation.optional(), xp: z.object({ basis: money, suggested: money }).optional() })
const inputs = z.object({
  families: money, tax: money, services: money, resources: z.array(resource),
  effectIds: z.array(label).optional(),
  military: militaryInputsSchema.optional(),
  payments: z.object({ liege: payment.optional(), tithe: payment.optional() }).optional(), xp: xpDecision.optional(),
  override: money.optional(), realized: money, adjustments: z.array(line), notes: z.string(), territories: z.array(territoryTurn).min(1).refine(uniqueTerritories).optional(),
})
const receipt = z.object({ month: monthSchema, name: label, ruler: label, liege: z.string(), inputs,
  opening: balances, closing: balances, gross: money, lines: z.array(line), review: review.optional(), xpAward: award.optional(), territories: z.array(territoryResult).optional() })
export const holdingSchema = z.object({
  id: label, name: label, ruler: label, liege: z.string(), first: monthSchema, opening: balances,
  families: money, tax: money, services: money, resources: z.array(resource),
  territories: z.array(territory).min(1).refine(uniqueTerritories).optional(),
  confidence: confidenceSchema.optional(),
  military: militarySchema.optional(),
  projects: z.array(projectSchema).optional(),
  liegeRate: rate.optional(), titheRate: rate.optional(), xpMode: xpMode.optional(),
  turns: z.array(receipt), replay: z.array(z.object({ month: monthSchema, inputs, xpAward: award.optional() })),
})
export type Payment = z.infer<typeof payment>
export type XpMode = z.infer<typeof xpMode>
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
  const newPayment = (rate: number): Payment => ({ rate, cash: 0, noncash: 0, approved: false, includeTribute: false })
  const liege = holding.liege.trim() ? newPayment(holding.liegeRate ?? 2000) : undefined
  const tithe = holding.titheRate === undefined ? undefined : newPayment(holding.titheRate)
  const mode = holding.xpMode
  return {
    ...holdingDefaults(holding),
    payments: liege || tithe ? { liege, tithe } : undefined,
    xp: mode && mode !== 'off' ? { mode, recipient: holding.ruler, approved: false } : undefined,
    territories: territoriesFor(holding).map(item => ({ ...item, applyGrowth, largeRate: 1, adjustment: 0 })),
  }
}

export function replayInputs(holding: Holding, month: TurnMonth): TurnInputs {
  const saved = holding.replay.find(item => sameMonth(item.month, month))?.inputs
  if (!saved) return territoryDefaults(holding)
  const previous = holding.turns.at(-1)?.territories
  const renewed = (item?: Payment) => item && { ...item, approved: false }
  return {
    ...saved,
    effectIds: undefined,
    payments: saved.payments && { liege: renewed(saved.payments.liege), tithe: renewed(saved.payments.tithe) },
    xp: saved.xp && { ...saved.xp, approved: false },
    territories: saved.territories?.map(item => ({
      ...item, families: previous?.find(result => result.id === item.id)?.closing ?? item.families, override: undefined,
    })),
  }
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

function holdingEffects(holding: Holding) {
  return [...(holding.confidence?.effects ?? []), ...(holding.projects ?? []).flatMap(project => project.costs)]
}

export function availableEffects(holding: Holding, month: TurnMonth) {
  const posted = new Set(holding.turns.flatMap(turn => turn.inputs.effectIds ?? []))
  return holdingEffects(holding).filter(effect => sameMonth(effect.target, month) && !posted.has(effect.id))
}

function approvedEffects(values: TurnInputs, holding?: Holding, month?: TurnMonth) {
  const ids = values.effectIds ?? []
  if (!ids.length) return []
  const available = holding && month ? availableEffects(holding, month) : []
  if (new Set(ids).size !== ids.length || ids.some(id => !available.some(effect => effect.id === id))) {
    throw new Error('A selected effect is no longer available for this turn.')
  }
  return available.filter(effect => ids.includes(effect.id))
}

function turnIncome(values: TurnInputs, effects: DomainEffect[] = []) {
  const draft = inputs.parse(values)
  draft.resources = draft.resources.map(item => ({ ...item, rate: item.rate ?? resourceRates[item.type] }))
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
  const adjusted = { tax, services, resource: total }
  for (const effect of effects) {
    if (effect.category !== 'general') adjusted[effect.category] = amount.parse(adjusted[effect.category] + effect.amount)
  }
  for (const key of ['tax', 'services', 'resource'] as const) {
    if (adjusted[key] < 0) throw new Error('An approved effect reduces an income category below zero.')
  }
  return { draft, territories, tax: money.parse(tax), services: money.parse(services), production, total, adjusted }
}

function estimate(income: ReturnType<typeof turnIncome>): z.infer<typeof review> {
  const { draft, adjusted: { tax, services, resource: total } } = income
  const tribute = draft.adjustments.filter(line => line.category === 'tribute' && line.amount > 0)
    .reduce((sum, line) => money.parse(sum + line.amount), 0)
  function obligation(kind: PaymentKind) {
    const payment = draft.payments?.[kind]
    if (!payment) return
    const basis = money.parse(tax + services + total + (payment.includeTribute ? tribute : 0))
    const suggested = Number((BigInt(basis) * BigInt(payment.rate) + 5000n) / 10000n)
    const manual = draft.adjustments.filter(line => line.category === kind && line.amount < 0)
      .reduce((sum, line) => money.parse(sum - line.amount), 0)
    return { basis, suggested, rate: payment.rate, manual }
  }
  const basis = money.parse(tax + total)
  return {
    liege: obligation('liege'), tithe: obligation('tithe'),
    xp: draft.xp && { basis, suggested: Number(BigInt(basis) / (draft.xp.mode === 'pc' ? 100n : 200n)) },
  }
}

export const turnEstimates = (values: TurnInputs, holding?: Holding, month?: TurnMonth) =>
  estimate(turnIncome(values, approvedEffects(values, holding, month)))

export function previewTurn(holding: Holding, month: TurnMonth, values: TurnInputs): Receipt {
  const effects = approvedEffects(values, holding, month)
  const income = turnIncome(values, effects)
  const { draft, territories, tax, services, production, total } = income
  const estimates = estimate(income)
  const opening = holding.turns.at(-1)?.closing ?? holding.opening
  for (const item of draft.adjustments) {
    if (item.category === 'tribute' && item.amount < 0) throw new Error('Incoming tribute must be a credit.')
    if ((item.category === 'liege' || item.category === 'tithe') && item.amount > 0) throw new Error('Liege payments and tithes must be debits.')
  }
  if (draft.realized > income.adjusted.resource) throw new Error('Resource cash realization exceeds resource production.')
  const lines: LedgerLine[] = [
    { name: 'Cash taxes', balance: 'cash', amount: tax },
    { name: 'Standard services', balance: 'noncash', amount: services },
    ...(draft.override === undefined ? production : [{ name: 'Resource override', balance: 'noncash' as const, amount: total }]),
  ]
  if (draft.realized) lines.push(
    { name: 'Resources realized in cash', balance: 'noncash', amount: -draft.realized },
    { name: 'Resources realized in cash', balance: 'cash', amount: draft.realized },
  )
  lines.push(...draft.adjustments, ...effects.map(effect => ({
    name: effect.title, balance: effect.balance, amount: effect.amount, effectId: effect.id,
  })))
  for (const item of draft.military?.decisions ?? []) {
    if (item.action === 'pay' && item.amount) lines.push({ name: item.charge.title, balance: item.charge.balance, amount: -item.amount })
  }
  for (const kind of ['liege', 'tithe'] as const) {
    const payment = draft.payments?.[kind]
    if (!payment?.approved) continue
    for (const balance of ['cash', 'noncash'] as const) {
      if (payment[balance]) lines.push({ name: paymentLabels[kind], balance, amount: -payment[balance], category: kind })
    }
  }
  const xpAward = draft.xp?.approved && estimates.xp
    ? { recipient: draft.xp.recipient, amount: draft.xp.override ?? estimates.xp.suggested } : undefined
  const closing = { ...opening }
  for (const item of lines) closing[item.balance] = amount.parse(closing[item.balance] + amount.parse(item.amount))
  for (const balance of ['cash', 'noncash'] as const) {
    if (closing[balance] < 0) throw new Error(`The ${balance} balance is short by ${formatGp(-closing[balance])}.`)
  }
  return receipt.parse({
    month, name: holding.name, ruler: holding.ruler, liege: holding.liege, inputs: draft,
    opening, closing, gross: income.adjusted.tax + income.adjusted.services + income.adjusted.resource, lines, territories,
    review: draft.payments || draft.xp ? estimates : undefined, xpAward,
  })
}

export function recordTurn(cal: Calendar, clock: number, holding: Holding, month: TurnMonth, draft: TurnInputs): Holding {
  if (!sameMonth(dueMonth(cal, holding), month) || closingDay(cal, month) > clock) throw new Error('This turn is no longer due. Refresh the preview.')
  const military = validateMilitaryTurn(cal, holding, month, draft.military)
  const result = previewTurn(holding, month, military ? { ...draft, military } : draft)
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
    replay: [...removed.map(({ month, inputs, xpAward }) => ({ month, inputs, xpAward })), ...holding.replay] }
}

export function formatGp(cp: number) {
  return `${(cp / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`
}

export function validHoldings(cal: Calendar, holdings: Holding[]) {
  if (new Set(holdings.map(item => item.id)).size !== holdings.length) return false
  try {
    return holdings.every(holding => {
      let last = closingDay(cal, holding.first) - 1
      if (holding.military && !validMilitary(holding.military)) return false
      militaryChargeState(holding.turns)
      if (holding.confidence) {
        const state = holding.confidence
        if (new Set(state.reviews.map(item => item.year)).size !== state.reviews.length) return false
        const ids = [...state.events, ...state.checks, ...state.effects].map(item => item.id)
        if (new Set(ids).size !== ids.length) return false
        const sources = new Set([...state.events, ...state.checks].map(item => item.id))
        for (const effect of state.effects) {
          if (!sources.has(effect.source)) return false
          closingDay(cal, effect.target)
        }
      }
      if (!validProjects(cal, holding.projects ?? [])) return false
      const effects = holdingEffects(holding)
      if (new Set(effects.map(item => item.id)).size !== effects.length) return false
      for (const effect of effects) closingDay(cal, effect.target)
      const postedEffects = holding.turns.flatMap(turn => turn.inputs.effectIds ?? [])
      if (new Set(postedEffects).size !== postedEffects.length || postedEffects.some(id => !effects.some(effect => effect.id === id))) return false
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

export function dominionEntries(holdings: Holding[], from: number, to: number, query = '') {
  const needle = query.trim().toLowerCase()
  return holdings.flatMap(holding => (holding.confidence?.events ?? [])
    .filter(event => event.status !== 'removed' && event.day >= from && event.day < to &&
      [event.title, event.notes, holding.name].some(value => value.toLowerCase().includes(needle)))
    .map(event => ({ ...event, holdingId: holding.id })))
}

export function constructionEntries(cal: Calendar, holdings: Holding[], from: number, to: number, query = '') {
  const needle = query.trim().toLowerCase()
  return holdings.flatMap(holding => (holding.projects ?? []).flatMap(project => {
    const done = confirmedCompletion(project)
    return [
      { id: 'start', day: project.start, label: 'Construction start' },
      { id: 'finish', day: done ?? forecast(cal, project), label: done !== undefined ? 'Construction completed' : 'Construction forecast' },
      { id: 'target', day: project.target, label: 'Construction target' },
      ...project.reviews.filter(review => review.incident !== undefined && review.roll !== undefined).map(review =>
        ({ id: review.id, day: review.incident, label: constructionOutcome(review.roll!).title })),
    ].flatMap(({ id, day, label }) => {
      const title = `${project.name} · ${label}`
      if (day === undefined || day < from || day >= to || ![holding.name, title, project.notes].some(value => value.toLowerCase().includes(needle))) return []
      return [{ id, day, title, holdingId: holding.id, projectId: project.id }]
    })
  }))
}
