import { z } from 'zod'
import { newProject } from './construction'
import { closingDay, dueMonth, monthAt, type Holding } from './domain'
import { rosterHistory } from './military'
import type { Campaign } from './storage'

const id = z.string().min(1).max(120)
const name = z.string().trim().min(1).max(120)
const date = z.number().int().min(-10_000_000_000).max(10_000_000_000)
const count = z.number().int().safe().nonnegative()
const participant = z.object({
  id, name, side: name, before: count.optional(), after: count.optional(), holdingId: id.optional(), unitId: id.optional(),
}).refine(item => !item.unitId || !!item.holdingId)
const base = z.object({ id, holdingId: id, day: date, status: z.enum(['proposed', 'applied', 'declined']) })
const consequence = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('troops'), unitId: id, delta: z.number().int().safe(), strength: count }),
  base.extend({ kind: z.literal('repair'), title: name, workDays: count.min(1).max(10_000_000), budget: count,
    projectId: id.optional(), costId: id.optional() }),
  base.extend({ kind: z.literal('expense'), title: name, amount: count.positive(), balance: z.enum(['cash', 'noncash']),
    prior: z.array(z.object({ title: name, day: date, amount: count.positive(), balance: z.enum(['cash', 'noncash']) })).optional() }),
  base.extend({ kind: z.literal('confidence') }),
])
export const engagementSchema = z.object({
  id, title: name, kind: z.enum(['battle', 'siege']), start: date, end: date.optional(),
  location: z.string().max(120), holdingId: id.optional(), projectId: id.optional(),
  participants: z.array(participant), outcome: z.string(), notes: z.string(), consequences: z.array(consequence),
}).refine(item => (item.kind === 'siege' || item.end === undefined) && (item.end === undefined || item.end >= item.start) &&
  (!item.projectId || !!item.holdingId) && new Set(item.participants.map(entry => entry.id)).size === item.participants.length &&
  new Set(item.consequences.map(entry => entry.id)).size === item.consequences.length)
export type Engagement = z.infer<typeof engagementSchema>
export type EngagementParticipant = z.infer<typeof participant>
export type Consequence = z.infer<typeof consequence>

export function activeSieges(items: readonly Engagement[], day: number) {
  return items.filter(item => item.kind === 'siege' && item.start <= day && (item.end === undefined || day <= item.end))
}

export function involvesHolding(item: Engagement, holdingId: string) {
  return item.holdingId === holdingId || item.participants.some(part => part.holdingId === holdingId)
    || item.consequences.some(effect => effect.holdingId === holdingId)
}

export function engagementEntries(items: readonly Engagement[], from: number, to: number, query = '') {
  const term = query.trim().toLowerCase()
  return items.flatMap(item => {
    if (term && ![item.title, item.location, item.outcome, item.notes, item.kind,
      ...item.participants.flatMap(person => [person.name, person.side])].some(value => value.toLowerCase().includes(term))) return []
    const entries = [{ key: `${item.id}:start`, day: item.start, title: item.kind === 'battle' ? item.title : `Siege begins · ${item.title}` }]
    if (item.end !== undefined) entries.push({ key: `${item.id}:end`, day: item.end, title: `Siege ends · ${item.title}` })
    return entries.filter(entry => entry.day >= from && entry.day < to).map(entry => ({ ...entry, engagementId: item.id, location: item.location }))
  })
}

export function rosterStrength(holding: Holding | undefined, unitId: string, day: number) {
  const unit = holding?.military?.units.find(item => item.id === unitId)
  const state = unit && rosterHistory(unit).filter(item => item.change.day <= day).at(-1)
  return state?.change.kind === 'release' ? undefined : state?.state.strength
}

export function expenseTarget(campaign: Campaign, holding: Holding, date: number) {
  const month = monthAt(campaign.calendar, date)
  return closingDay(campaign.calendar, month) >= closingDay(campaign.calendar, dueMonth(campaign.calendar, holding)) ? month : dueMonth(campaign.calendar, holding)
}

export function saveEngagement(campaign: Campaign, draft: Engagement): Campaign {
  const saved = engagementSchema.parse(draft)
  const items = campaign.engagements ?? []
  return { ...campaign, engagements: items.some(item => item.id === saved.id)
    ? items.map(item => item.id === saved.id ? saved : item) : [...items, saved] }
}

export function replaceConsequence(item: Engagement, draft: Consequence): Engagement {
  return { ...item, consequences: item.consequences.some(effect => effect.id === draft.id)
    ? item.consequences.map(effect => effect.id === draft.id ? draft : effect)
    : [...item.consequences, draft] }
}

export function applyConsequence(campaign: Campaign, engagementId: string, id: string): Campaign {
  const engagement = campaign.engagements?.find(item => item.id === engagementId)
  const effect = engagement?.consequences.find(item => item.id === id)
  if (!engagement || !effect || effect.status !== 'proposed') throw new Error('This consequence is no longer awaiting approval.')
  const holding = campaign.holdings?.find(item => item.id === effect.holdingId)
  if (!holding) throw new Error('Choose an available holding.')
  let updated = holding
  let result: Consequence = { ...effect, status: 'applied' }
  switch (effect.kind) {
    case 'troops': {
      if (effect.day < engagement.start || effect.day > (engagement.kind === 'battle' ? engagement.start : engagement.end ?? campaign.current) || effect.day > campaign.current) {
        throw new Error('Choose a troop change date within the engagement and through the campaign date.')
      }
      if (!effect.delta || rosterStrength(holding, effect.unitId, effect.day) !== effect.strength) throw new Error('Refresh the proposed roster strength and confirm a nonzero change.')
      const military = holding.military!
      const units = military.units.map(unit => {
        if (unit.id !== effect.unitId) return unit
        const amended = { ...unit, changes: [...unit.changes, {
          id, kind: 'correction' as const, day: effect.day, delta: effect.delta, notes: `${engagement.title} · approved engagement outcome`,
        }] }
        rosterHistory(amended)
        return amended
      })
      updated = { ...holding, military: { ...military, units } }
      break
    }
    case 'expense': {
      const target = expenseTarget(campaign, holding, effect.day)
      updated = { ...holding, engagementExpenses: [...(holding.engagementExpenses ?? []), {
        id, source: engagement.id, title: effect.title, target, amount: -effect.amount, category: 'general', balance: effect.balance,
      }] }
      break
    }
    case 'repair': {
      if (effect.projectId) {
        const project = holding.projects?.find(item => item.id === effect.projectId)
        if (!project || effect.costId && !project.costs.some(item => item.id === effect.costId)) throw new Error('Choose an available repair project and cost.')
      } else {
        const project = { ...newProject(campaign.calendar, effect.day), id, name: effect.title, workDays: effect.workDays,
          budget: effect.budget, notes: `Repairs from ${engagement.title}` }
        updated = { ...holding, projects: [...(holding.projects ?? []), project] }
        result = { ...effect, status: 'applied', projectId: project.id }
      }
      break
    }
    case 'confidence': throw new Error('Approve the check through confidence review.')
  }
  return saveEngagement({ ...campaign, holdings: campaign.holdings?.map(item => item.id === holding.id ? updated : item) },
    replaceConsequence(engagement, result))
}

export function correctEngagementExpense(campaign: Campaign, engagement: Engagement, effect: Extract<Consequence, { kind: 'expense' }>) {
  const holding = campaign.holdings?.find(item => item.id === effect.holdingId)
  const original = engagement.consequences.find(item => item.id === effect.id)
  if (!holding || original?.kind !== 'expense' || original.holdingId !== effect.holdingId || original.status !== 'applied' ||
    !holding.engagementExpenses?.some(item => item.id === effect.id)) throw new Error('This expense is no longer available.')
  if (holding.turns.some(turn => turn.inputs.effectIds?.includes(effect.id))) throw new Error('Reopen the posted turn before correcting this expense.')
  const target = expenseTarget(campaign, holding, effect.day)
  const expenses = holding.engagementExpenses.map(item => item.id === effect.id
    ? { ...item, title: effect.title, target, balance: effect.balance, amount: -effect.amount } : item)
  return saveEngagement({ ...campaign, holdings: campaign.holdings?.map(item => item.id === holding.id ? { ...item, engagementExpenses: expenses } : item) },
    replaceConsequence(engagement, { ...effect, status: 'applied', prior: [...(original.prior ?? []),
      { title: original.title, day: original.day, amount: original.amount, balance: original.balance }] }))
}

export function validEngagements(items: readonly Engagement[], holdings: readonly Holding[]) {
  const consequenceIds = items.flatMap(item => item.consequences.map(effect => effect.id))
  if (new Set(consequenceIds).size !== consequenceIds.length) return false
  return items.every(item => item.consequences.every(effect => {
    if (effect.status !== 'applied') return true
    const holding = holdings.find(entry => entry.id === effect.holdingId)
    switch (effect.kind) {
      case 'troops': return !!holding?.military?.units.find(unit => unit.id === effect.unitId)?.changes.some(change =>
        change.id === effect.id && change.kind === 'correction' && change.day === effect.day && change.delta === effect.delta)
      case 'expense': return !!holding?.engagementExpenses?.some(expense => expense.id === effect.id && expense.source === item.id && expense.amount === -effect.amount)
      case 'repair': return !!holding?.projects?.some(project => project.id === effect.projectId)
      case 'confidence': return !!holding?.confidence?.checks.some(check => check.id === effect.id)
    }
  }))
}
