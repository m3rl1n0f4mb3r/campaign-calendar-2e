import { z } from 'zod'

const id = z.string().min(1).max(120)
const text = z.string().trim().min(1).max(120)
const scaled = z.number().int().safe().nonnegative()
const positive = scaled.min(1)
const day = z.number().int().min(-10_000_000_000).max(10_000_000_000)
export const moduleSchema = z.object({
  id, name: text, unit: text, dimensions: z.string().max(240), technology: z.number().int().min(0).max(99),
  cost: scaled, labor: scaled, source: z.string().max(160),
})
export type CastleModule = z.infer<typeof moduleSchema>
const rows: [string, string, string, string, number, number, number][] = [
  ['barbican-small', 'Small barbican', 'structure', 'Two small towers, 20 ft apart', 4, 1665, 28600],
  ['barbican-medium', 'Medium barbican', 'structure', 'Two medium towers, 20 ft apart', 5, 2050, 35200],
  ['barbican-large', 'Large barbican', 'structure', 'Two medium towers, 40 ft apart', 6, 2880, 49500],
  ['stone-small', 'Small stone building', 'building', '20 × 20 ft interior', 3, 64, 2000],
  ['stone-medium', 'Medium stone building', 'building', '800 sq ft interior', 3, 96, 3000],
  ['stone-large', 'Large stone building', 'building', '1,800 sq ft interior', 3, 144, 4500],
  ['stone-great', 'Great stone building', 'building', '30 × 60 ft typical, two floors', 4, 300, 10000],
  ['stone-grand', 'Grand stone building', 'building', '80 × 40 ft typical, three floors', 4, 600, 19000],
  ['wood-small', 'Small wooden building', 'building', '20 × 20 ft', 1, 8, 40],
  ['wood-medium', 'Medium wooden building', 'building', '40 × 20 ft', 1, 12, 60],
  ['wood-large', 'Large wooden building', 'building', '1,800 sq ft', 1, 18, 90],
  ['wood-great', 'Great wooden building', 'building', 'Two floors of 1,800 sq ft each', 2, 40, 200],
  ['wood-grand', 'Grand wooden building', 'building', '80 × 40 ft, three floors', 2, 75, 375],
  ['ditch', 'Ditch', 'section', '10 ft long × 10 ft wide × 5 ft deep', 1, 2, 10],
  ['drawbridge', 'Drawbridge', 'bridge', '20 × 10 ft typical', 2, 40, 550],
  ['gate-lesser', 'Lesser gatekeep', 'structure', 'Two small round towers set 20 ft out', 5, 1950, 33275],
  ['gate-greater', 'Greater gatekeep', 'structure', 'Four medium round towers', 6, 4625, 40620],
  ['gate-grand', 'Grand gatekeep', 'structure', 'Four large round towers; forward pair 40 ft apart', 7, 6410, 110800],
  ['moat', 'Moat or channel', 'section', '10 ft long × 10 ft wide × 5 ft deep', 3, 6, 30],
  ['motte', 'Motte', 'earthwork section', '10 × 10 ft area raised 5 ft', 1, 2, 10],
  ['palisade', 'Palisade', 'section', '10 ft long × 5 ft high', 1, 1, 5],
  ['round-small', 'Small round tower', 'two-level module', '30 ft interior diameter; 30 ft tall', 4, 720, 12000],
  ['round-medium', 'Medium round tower', 'two-level module', '40 ft interior diameter; 30 ft tall', 5, 900, 15000],
  ['round-large', 'Large round tower', 'two-level module', '60 ft interior diameter; 30 ft tall', 6, 1260, 21000],
  ['square-small', 'Small square tower', 'two-level module', '30 × 30 ft interior; 30 ft tall', 3, 840, 14000],
  ['square-medium', 'Medium square tower', 'two-level module', '40 × 40 ft interior; 30 ft tall', 4, 1080, 18000],
  ['square-large', 'Large square tower', 'two-level module', '60 × 60 ft interior; 30 ft tall', 5, 1440, 24000],
  ['tunnel', 'Tunnel', 'excavated volume', '1,000 cu ft', 4, 25, 100],
  ['wall-stone', 'Stone wall', 'section', '10 ft long × 10 ft thick × 15 ft high', 3, 30, 500],
  ['wall-hoarding', 'Stone wall with hoarding', 'section', '10 ft stone wall section', 4, 36, 600],
  ['wall-glacis', 'Stone wall with glacis', 'section', '10 ft stone wall section', 5, 44, 720],
  ['wall-machicolation', 'Stone wall with machicolation', 'section', '10 ft stone wall section; includes glacis', 6, 53, 864],
  ['wall-postern', 'Stone wall postern', 'add-on', 'Added to the cost and labor of a wall section', 4, 5, 100],
  ['wall-wood', 'Wooden wall', 'section', '10 × 15 ft surface; 3 in thick', 1, 1, 5],
]
export function defaultCatalog(): CastleModule[] {
  return rows.map(([id, name, unit, dimensions, technology, weeks, gp]) => ({
    id, name, unit, dimensions, technology, cost: gp * 100, labor: weeks * 100, source: 'The Castle Guide, pp. 54–58',
  }))
}
export const siteFactors = {
  climate: { label: 'Climate', options: { Arctic: 400, 'Sub-arctic': 250, Temperate: 125, Moderate: 100, 'Sub-tropical': 125, Tropical: 150 } },
  geography: { label: 'Geography', options: { 'High mountains': 400, 'Moderate mountains': 300, 'Low mountains': 200, Foothills: 150, 'Rolling hills': 100, Plains: 75 } },
  cover: { label: 'Ground cover', options: { Jungle: 300, 'Dense forest': 200, 'Light forest': 150, Scrub: 100, Grasslands: 75, Barren: 150, Desert: 200, Swamp: 200 } },
  resources: { label: 'Resource availability', options: { 'Distant and poor': 200, 'Distant and good': 150, 'Near and poor': 125, 'Near and good': 100 } },
  society: { label: 'Local social structure', options: { Nomadic: 250, 'Semi-nomadic': 175, 'Primitive agricultural': 125, Agricultural: 100, 'Advanced agricultural': 75 } },
  skill: { label: 'Worker skill', options: { 'Very poor': 300, Poor: 200, Average: 100, Good: 75, 'Very good': 50 } },
  morale: { label: 'Worker morale', options: { 'Very poor': 300, Poor: 200, Average: 100, High: 75, 'Very high': 50 } },
}
export type FactorKey = keyof typeof siteFactors
export const factorKeys = Object.keys(siteFactors) as FactorKey[]
export function factorOptions(key: FactorKey) {
  return Object.entries(siteFactors[key].options)
}
const line = z.object({
  id, module: moduleSchema.optional(), description: z.string().max(120), unit: z.string().max(120),
  quantity: positive, cost: scaled, labor: scaled,
}).refine(item => !item.module || item.quantity % 100 === 0, 'Catalog quantities must be whole')
const finish = z.enum(['standard', 'ornate', 'spartan'])
export const finishRates = { standard: 100, ornate: 150, spartan: 75 }
export const estimateSchema = z.object({
  id, name: text, lines: z.array(line).refine(items => new Set(items.map(item => item.id)).size === items.length), finish,
  factors: z.object({ climate: z.string(), geography: z.string(), cover: z.string(), resources: z.string(), society: z.string(), skill: z.string(), morale: z.string() })
    .refine(values => factorKeys.every(key => values[key] === '' || factorOptions(key).some(([name]) => name === values[key]))),
  modifier: positive.optional(), modifierReason: z.string(),
  approvedBudget: scaled.optional(), budgetReason: z.string(), duration: positive, assumptions: z.string(),
})
const step = z.object({ cost: z.string(), labor: z.string() })
const resultSchema = z.object({ base: step, finished: step, overhead: step, calculatedModifier: positive, appliedModifier: positive, cost: scaled, labor: scaled })
export const estimateSnapshotSchema = z.object({
  id, estimate: estimateSchema, result: resultSchema, approvedAt: day, workWeek: positive, workDays: positive, budget: scaled,
})
export type Estimate = z.infer<typeof estimateSchema>
export type EstimateLine = z.infer<typeof line>
export type EstimateSnapshot = z.infer<typeof estimateSnapshotSchema>

export function newEstimate(): Estimate {
  return { id: crypto.randomUUID(), name: 'New castle estimate', lines: [], finish: 'standard',
    factors: { climate: 'Moderate', geography: 'Rolling hills', cover: 'Scrub', resources: 'Near and good',
      society: 'Agricultural', skill: 'Average', morale: 'Average' },
    modifierReason: '', budgetReason: '', duration: 100, assumptions: '' }
}

const round = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (denominator * 2n)
const safe = (n: bigint) => {
  const value = Number(n)
  if (!Number.isSafeInteger(value)) throw new Error('The estimate exceeds the supported numeric range.')
  return value
}

function decimal(value: bigint, places: number) {
  const digits = value.toString().padStart(places + 1, '0')
  const fraction = digits.slice(-places).replace(/0+$/, '')
  return digits.slice(0, -places) + (fraction ? `.${fraction}` : '')
}

export function calculateEstimate(estimate: Estimate) {
  const draft = estimateSchema.parse(estimate)
  const totals = draft.lines.reduce((total, item) => {
    const quantity = BigInt(item.quantity)
    return { cost: total.cost + quantity * BigInt(item.cost), labor: total.labor + quantity * BigInt(item.labor) }
  }, { cost: 0n, labor: 0n })
  const multiplier = BigInt(finishRates[draft.finish])
  const finished = { cost: totals.cost * multiplier, labor: totals.labor * multiplier }
  const overhead = { cost: finished.cost * 110n, labor: finished.labor * 110n }
  const factors = factorKeys.map(key => factorOptions(key).find(([name]) => name === draft.factors[key])?.[1] ?? 100)
  const product = factors.reduce((value, factor) => value * BigInt(factor), 1n)
  const calculatedModifier = safe(round(product, 100n ** BigInt(factors.length - 1)))
  const appliedModifier = draft.modifier ?? calculatedModifier
  const laborAfterOverhead = round(overhead.labor, 100_000_000n)
  return {
    base: { cost: decimal(totals.cost, 4), labor: decimal(totals.labor, 4) },
    finished: { cost: decimal(finished.cost, 6), labor: decimal(finished.labor, 6) },
    overhead: { cost: decimal(overhead.cost, 8), labor: laborAfterOverhead.toString() },
    calculatedModifier, appliedModifier,
    cost: safe(round(overhead.cost * BigInt(appliedModifier), 100_000_000n)),
    labor: safe(round(laborAfterOverhead * BigInt(appliedModifier), 100n)),
  }
}

export function approveEstimate(estimate: Estimate, workWeek: number, approvedAt: number, snapshotId: string = crypto.randomUUID()): EstimateSnapshot {
  if (!estimate.lines.length || estimate.lines.some(item => !item.description.trim() || !item.unit.trim())) {
    throw new Error('Add at least one estimate line and give each line a description and unit.')
  }
  if (estimate.modifier !== undefined && !estimate.modifierReason.trim()) throw new Error('Enter a reason for the Production Modifier override.')
  const result = calculateEstimate(estimate)
  if (estimate.approvedBudget !== undefined && estimate.approvedBudget !== result.cost && !estimate.budgetReason.trim()) {
    throw new Error('Enter a reason for the budget override.')
  }
  const workDays = safe((BigInt(estimate.duration) * BigInt(workWeek) + 99n) / 100n)
  return estimateSnapshotSchema.parse({ id: snapshotId, estimate, result, approvedAt,
    workWeek, workDays, budget: estimate.approvedBudget ?? result.cost })
}
