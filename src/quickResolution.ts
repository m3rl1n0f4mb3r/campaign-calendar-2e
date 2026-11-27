import { z } from 'zod'
import { participantRole, saveEngagement, type Engagement } from './engagement'
import type { Campaign } from './storage'

const id = z.string().min(1).max(120)
const text = z.string().trim().min(1).max(120)
const day = z.number().int().min(-10_000_000_000).max(10_000_000_000)
const points = z.number().int().min(0).max(100_000_000)
const morale = z.number().int().min(-10_000).max(10_000)
const side = z.enum(['a', 'b'])
const conditions = z.object({
  commander: z.number().int().min(0).max(100),
  casters: z.boolean(), supernatural: z.boolean(), engines: z.boolean(), flying: z.boolean(),
  supplies: z.enum(['supplied', 'short', 'depleted']),
})
const force = conditions.extend({ name: text, points: points.positive(), morale })
const forces = z.object({ a: force, b: force })
const position = z.object({ points, morale })
const positions = z.object({ a: position, b: position })
const battleState = z.object({
  checked: z.array(side), withdrawal: side.optional(), pursuit: side.optional(), rallyChecked: z.boolean(),
})
const modifier = z.object({ label: z.string(), value: z.number().int() })
const end = z.enum(['a', 'b', 'undecided'])
const step = z.object({
  kind: z.enum(['round', 'phase', 'morale', 'rally', 'allow', 'pursue', 'conditions', 'finish']),
  day, before: positions, after: positions, conditions: z.object({ a: conditions, b: conditions }),
  battle: battleState, results: z.array(z.string()), winner: end.optional(),
  roll: z.number().int().min(1).max(100).optional(), adjusted: z.number().int().optional(),
  modifiers: z.array(modifier), actor: side.optional(), note: z.string(),
})
export const quickResolutionSchema = z.object({
  id, title: text, kind: z.enum(['battle', 'siege']), start: day,
  engagementId: id.optional(), rules: z.literal('DMGR2 chapter 8 v1'),
  forces, steps: z.array(step),
  approval: z.object({ day, outcome: z.string().trim().min(1), reason: z.string(), narrative: z.string().optional() }).optional(),
}).refine(item => item.steps.every((entry, index) => entry.day >= (item.steps[index - 1]?.day ?? item.start) &&
  (item.kind === 'siege' || entry.day === item.start)) && (!item.approval || !!item.engagementId && !!item.steps.at(-1)?.winner))
export type Resolution = z.infer<typeof quickResolutionSchema>
export type ResolutionStep = z.infer<typeof step>
export type Force = z.infer<typeof force>
export type Conditions = z.infer<typeof conditions>
type Side = z.infer<typeof side>
type Winner = z.infer<typeof end>
type Modifier = z.infer<typeof modifier>
type StepInput = { kind: 'round' | 'phase' | 'morale' | 'rally'; roll: number; day?: number; actor?: Side; adjustment?: number }
  | { kind: 'allow' | 'pursue' }
  | { kind: 'conditions'; side: Side; conditions: Conditions; morale?: number }
  | { kind: 'finish'; winner: Winner; note: string }

export function initialForceName(kind: Resolution['kind'], side: Side, engagement?: Engagement) {
  const role = side === 'a' ? 'attacker' : 'defender'
  const fallback = kind === 'siege' ? side === 'a' ? 'Attackers' : 'Defenders' : side === 'a' ? 'Force A' : 'Force B'
  const names = [...new Set(engagement?.participants.filter(participant => participantRole(participant) === role).map(participant => participant.name))]
  const combined = names.join(', ')
  return combined && combined.length <= 120 ? combined : fallback
}

export function defaultForce(name: string): Force {
  return { name, points: 100, morale: 10, commander: 0, casters: false, supernatural: false, engines: false, flying: false, supplies: 'supplied' }
}

export function resolutionState(resolution: Resolution) {
  const latest = resolution.steps.at(-1)
  const { a, b } = resolution.forces
  return {
    day: latest?.day ?? resolution.start,
    positions: latest?.after ?? { a: { points: a.points, morale: a.morale }, b: { points: b.points, morale: b.morale } },
    conditions: latest?.conditions ?? { a, b },
    battle: latest?.battle ?? { checked: [], rallyChecked: false },
    winner: latest?.winner, results: latest?.results ?? [],
  }
}

const opposite = (side: Side): Side => side === 'a' ? 'b' : 'a'
const sides = ['a', 'b'] as const

export function nextResolutionAction(resolution: Resolution): { kind: 'round' | 'phase' | 'morale' | 'rally' | 'withdrawal' | 'adjudicate' | 'finished'; actor?: Side } {
  const state = resolutionState(resolution)
  if (state.winner) return { kind: 'finished' }
  if (state.results.length > 1) return { kind: 'adjudicate' }
  const { a, b } = state.positions
  if (resolution.kind === 'siege') return { kind: 'phase', actor: b.morale >= a.morale + 2 || a.morale < 9 ? 'b' : 'a' }
  const { pursuit, withdrawal, checked, rallyChecked } = state.battle
  if (withdrawal) return { kind: 'withdrawal', actor: withdrawal }
  const fleeing = sides.filter(side => side !== pursuit && !checked.includes(side) && state.positions[side].morale < 7)
  if (fleeing.length === 2 || (fleeing.length && pursuit)) return { kind: 'adjudicate' }
  if (fleeing.length) return { kind: 'withdrawal', actor: fleeing[0] }
  if (pursuit && !rallyChecked) return { kind: 'rally', actor: pursuit }
  const atRisk = sides.find(side => side !== pursuit && !checked.includes(side) && state.positions[side].points * 5 <= resolution.forces[side].points * 2)
  return atRisk ? { kind: 'morale', actor: atRisk } : { kind: 'round' }
}

function moraleModifier(value: number) {
  if (value <= 4) return -20
  if (value <= 7) return -10
  if (value <= 10) return 0
  return Math.min(25, Math.floor((value - 9) / 2) * 5)
}

export function resolutionModifiers(resolution: Resolution, day: number, adjustment = 0): Modifier[] {
  const { positions, conditions, battle } = resolutionState(resolution)
  const { a, b } = conditions
  const left = positions.a.points
  const right = positions.b.points
  const siege = resolution.kind === 'siege'
  const ratio = siege
    ? left <= right ? -15 : 2 * left <= 3 * right ? -10 : left <= 2 * right ? -5 : left <= 3 * right ? 5 : 10
    : right >= 2 * left ? -20 : 2 * right >= 3 * left ? -10 : left >= 2 * right ? 20 : 2 * left >= 3 * right ? 10 : 0
  const command = (a.commander - b.commander) / 2
  const elapsed = Math.max(0, day - resolution.start)
  const modifiers = [
    { label: 'Force size', value: ratio },
    { label: 'Morale', value: moraleModifier(positions.a.morale) - moraleModifier(positions.b.morale) },
    { label: 'Command', value: Math.trunc(command) * 5 },
    { label: 'Spellcasters', value: (Number(a.casters) - Number(b.casters)) * (siege ? 10 : 5) },
    { label: 'Magical or undead forces', value: (Number(a.supernatural) - Number(b.supernatural)) * 5 },
    { label: siege ? 'Cannon' : 'Bombardment engines', value: siege ? a.engines === b.engines ? 0 : a.engines ? 10 : -5 : (Number(a.engines) - Number(b.engines)) * 5 },
    { label: 'Flying forces', value: siege ? a.flying && !b.flying ? 5 : 0 : (Number(a.flying) - Number(b.flying)) * 5 },
    { label: 'Supplies', value: siege ? (b.supplies === 'supplied' ? 0 : b.supplies === 'short' ? 5 : 10) - (a.supplies === 'supplied' ? 0 : a.supplies === 'short' ? 5 : 10)
      : (Number(b.supplies !== 'supplied') - Number(a.supplies !== 'supplied')) * 10 },
    { label: 'Siege duration', value: siege ? Math.min(20, Math.floor(Math.max(0, elapsed - 1) / 20) * 5) : 0 },
    { label: 'Pursuit', value: battle.pursuit === 'a' ? -35 : battle.pursuit === 'b' ? 35 : 0 },
    { label: 'GM adjustment', value: adjustment },
  ]
  return modifiers.filter(item => item.value)
}

// DMGR2 pp. 107 and 113. Each row holds its upper bound, losses for A and B, and their morale changes.
const battleResults = [
  [0, 25, 0, -2, 1], [10, 20, 0, -1, 1], [20, 15, 5, 0, 0], [30, 10, 5, 0, 0],
  [70, 5, 5, 0, 0], [80, 5, 10, 0, 0], [90, 5, 15, 0, 0], [99, 0, 20, 1, -1],
  [Infinity, 0, 25, 1, -2],
]
const siegeResults = [
  [15, 15, 0, -2, 1], [25, 10, 0, -1, 1], [40, 5, 0, -1, 0], [65, 20, 5, 0, 0],
  [80, 15, 5, 1, -1], [90, 10, 5, 1, -2], [99, 5, 5, 1, -2],
]

export function resolveStep(resolution: Resolution, input: StepInput): Resolution {
  if (resolution.approval) throw new Error('Approved resolutions are preserved in history.')
  const state = resolutionState(resolution)
  const next = nextResolutionAction(resolution)
  if (next.kind === 'finished') throw new Error('This resolution is finished. Undo its latest step to continue.')
  const record: ResolutionStep = {
    kind: input.kind, day: state.day, before: state.positions, after: state.positions, conditions: state.conditions,
    battle: { ...state.battle }, modifiers: [], results: [], note: '',
  }
  if (input.kind === 'finish') {
    if (!input.note.trim()) throw new Error('Enter a reason for finishing by GM decision.')
    record.winner = input.winner
    record.note = input.note.trim()
    record.results = ['GM decision']
  } else if (next.kind === 'adjudicate') {
    throw new Error('Resolve the competing outcomes by GM decision.')
  } else if (input.kind === 'conditions') {
    record.conditions = { ...state.conditions, [input.side]: input.conditions }
    const value = input.morale
    if (value !== undefined) record.after = { ...state.positions, [input.side]: { ...state.positions[input.side], morale: value } }
    record.actor = input.side
    record.results = ['GM recorded new conditions']
  } else if (input.kind === 'allow' || input.kind === 'pursue') {
    if (next.kind !== 'withdrawal' || !next.actor) throw new Error('No withdrawal decision is pending.')
    record.actor = next.actor
    record.battle.withdrawal = undefined
    if (input.kind === 'allow') {
      record.winner = opposite(next.actor)
      record.results = ['Withdrawal allowed']
    } else {
      record.battle.pursuit = next.actor
      record.battle.rallyChecked = false
      record.results = ['Withdrawal pursued']
    }
  } else if ('roll' in input) {
    if (next.kind !== input.kind) throw new Error('Complete the current prompt before rolling.')
    const check = input.kind === 'morale' || input.kind === 'rally'
    if (!Number.isInteger(input.roll) || input.roll < 1 || input.roll > (check ? 20 : 100)) throw new Error(`Enter a d${check ? 20 : 100} roll in range.`)
    record.roll = input.roll
    if (check && next.actor) {
      const actor = next.actor
      const passed = input.roll <= state.positions[actor].morale
      record.actor = actor
      record.results = [passed ? 'Morale check passed' : 'Morale check failed']
      record.battle.checked = [...record.battle.checked, actor]
      if (input.kind === 'rally') {
        record.battle.rallyChecked = true
        if (passed) record.battle.pursuit = undefined
      } else if (!passed) {
        if (record.battle.pursuit) record.results = ['Both sides attempt to quit the field', 'GM adjudication required']
        else record.battle.withdrawal = actor
      }
    } else {
      const siege = input.kind === 'phase'
      const effective = siege ? input.day ?? state.day : resolution.start
      if (effective < state.day || (input.adjustment !== undefined && (!Number.isInteger(input.adjustment) || Math.abs(input.adjustment) > 1000))) {
        throw new Error('Choose a phase on or after the preceding date and a valid GM adjustment.')
      }
      record.day = effective
      record.actor = siege ? input.actor ?? next.actor : undefined
      record.modifiers = resolutionModifiers(resolution, effective, input.adjustment)
      record.adjusted = input.roll + record.modifiers.reduce((total, item) => total + item.value, 0)
      const adjusted = record.adjusted
      if (siege && (adjusted <= 0 || adjusted >= 100)) {
        record.winner = adjusted <= 0 ? 'b' : 'a'
        record.results = [adjusted <= 0 ? 'Attackers revolt' : 'Garrison surrenders']
      } else {
        const [, lossA, lossB, moraleA, moraleB] = (siege ? siegeResults : battleResults).find(row => adjusted <= row[0])!
        const { a, b } = record.before
        const loss = (points: number, value: number) => Math.min(points, siege ? Math.ceil(points * value / 100) : value)
        record.after = { a: { points: a.points - loss(a.points, lossA), morale: a.morale + moraleA },
          b: { points: b.points - loss(b.points, lossB), morale: b.morale + moraleB } }
        record.battle.checked = []
        record.battle.rallyChecked = false
        const after = record.after
        const outcomes: { winner: Side; label: string }[] = []
        if (!after.a.points || (siege && (after.a.points * 4 <= resolution.forces.a.points || after.a.morale <= 6 || after.b.morale - after.a.morale >= 8))) {
          outcomes.push({ winner: 'b', label: siege ? 'Attackers abandon the siege' : 'Force A has no points remaining' })
        }
        if (!after.b.points || (siege && (after.b.morale <= 3 || after.a.morale - after.b.morale >= 10))) {
          outcomes.push({ winner: 'a', label: siege ? 'Garrison surrenders or ceases resistance' : 'Force B has no points remaining' })
        }
        record.results = outcomes.map(item => item.label)
        record.winner = outcomes.length === 1 ? outcomes[0].winner : undefined
      }
    }
  }
  return quickResolutionSchema.parse({ ...resolution, steps: [...resolution.steps, record] })
}

export function storeResolution(campaign: Campaign, resolution: Resolution): Campaign {
  const draft = quickResolutionSchema.parse(resolution)
  const items = campaign.resolutions ?? []
  return { ...campaign, resolutions: items.some(item => item.id === draft.id)
    ? items.map(item => item.id === draft.id ? draft : item) : [...items, draft] }
}

export function resolutionSummary(resolution: Resolution) {
  const state = resolutionState(resolution)
  const figures = sides.map(side => `${resolution.forces[side].name}: ${state.positions[side].points} of ${resolution.forces[side].points} force points remaining, morale ${state.positions[side].morale}`)
  const winner = state.winner && state.winner !== 'undecided' ? `${resolution.forces[state.winner].name} prevails` : 'No winner recorded'
  return [winner, ...state.results, ...figures, resolution.steps.at(-1)?.note].filter(Boolean).join('. ')
}

export function approveResolution(campaign: Campaign, resolution: Resolution, outcome: string, reason: string, engagementId?: string, narrative = ''): Campaign {
  const stored = campaign.resolutions?.find(item => item.id === resolution.id)
  if (!stored || stored.approval || !resolutionState(stored).winner) throw new Error('Finish the draft before approving the outcome.')
  const existing = campaign.engagements?.find(item => item.id === engagementId)
  if (engagementId && (!existing || existing.kind !== stored.kind || existing.start !== stored.start)) {
    throw new Error('Choose an engagement of the same type and start date.')
  }
  if (outcome.trim() !== resolutionSummary(stored) && !reason.trim()) throw new Error('Enter a reason for overriding the mechanical result.')
  const engagement: Engagement = existing ?? { id: crypto.randomUUID(), title: stored.title, kind: stored.kind, start: stored.start,
    location: '', notes: '', outcome: '', consequences: [], participants: sides.map(side => ({
      id: crypto.randomUUID(), name: stored.forces[side].name, role: side === 'a' ? 'attacker' : 'defender', side: stored.kind === 'siege' ? side === 'a' ? 'Attackers' : 'Defenders' : side.toUpperCase(),
    })) }
  const end = stored.kind === 'siege' && resolutionState(stored).winner !== 'undecided' ? resolutionState(stored).day : existing?.end
  const reported = [outcome.trim(), narrative.trim()].filter(Boolean).join('\n\n')
  return storeResolution(saveEngagement(campaign, { ...engagement, end, outcome: reported }), {
    ...stored, engagementId: engagement.id, approval: { day: campaign.current, outcome: outcome.trim(), reason: reason.trim(), narrative: narrative.trim() || undefined },
  })
}
