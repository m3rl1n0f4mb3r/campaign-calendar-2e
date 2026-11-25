import { z } from 'zod'
import { template, type Calendar } from './calendar'
import { holdingSchema, validHoldings, type Holding } from './domain'
import { estimateSchema, moduleSchema, type CastleModule, type Estimate } from './estimate'
import type { Series } from './events'

const coordinate = z.number().int().min(-10_000_000_000).max(10_000_000_000)
const positive = z.number().int().min(1).max(10000)
const name = z.string().trim().min(1).max(120)
const hexColor = z.string().regex(/^#[\da-f]{6}$/i)
const calendar = z.object({
  periods: z.array(z.object({ id: name, name, days: positive.max(366), festival: z.boolean() })).min(1).max(60),
  weekdays: z.array(name).min(1).max(30),
  before: z.string(), after: z.string(), skipZero: z.boolean(),
  showMoons: z.boolean().optional(),
  moons: z.array(z.object({ name, cycle: z.number().finite().positive().max(100000), anchor: coordinate, phase: z.number().int().min(0).max(7), source: z.string(), color: hexColor.optional() })).max(30),
}).refine(value => value.periods.some(p => !p.festival) && new Set(value.periods.map(p => p.id)).size === value.periods.length, 'Calendar needs a month and unique period IDs')
const eventData = z.object({
  title: name, location: z.string(), notes: z.string(), color: hexColor,
  start: coordinate, end: coordinate, allDay: z.boolean(),
})
const validRange = (event: z.infer<typeof eventData>) => event.end > event.start && (!event.allDay || (event.start % 1440 === 0 && event.end % 1440 === 0))
const series = eventData.extend({
  id: name,
  rule: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']), interval: positive,
    weekdays: z.array(z.number().int().min(0).max(29)), count: positive.optional(), until: coordinate.optional(),
    festival: z.enum(['previous', 'next', 'festival']),
  }).optional(),
  exceptions: z.record(z.string().regex(/^-?\d+$/), eventData.refine(validRange).nullable()),
  cutoff: coordinate.optional(),
}).refine(validRange, 'Event end must follow its start')

export type Campaign = { id: string; name: string; calendar: Calendar; current: number; events: Series[]; holdings?: Holding[]; castleCatalog?: CastleModule[]; castleEstimates?: Estimate[] }
export type Store = { version: 1; active: string; campaigns: Campaign[] }
const campaignSchema = z.object({ id: name, name, calendar, current: coordinate, events: z.array(series), holdings: z.array(holdingSchema).optional(),
  castleCatalog: z.array(moduleSchema).optional(), castleEstimates: z.array(estimateSchema).optional(),
}).refine(campaign =>
  validHoldings(campaign.calendar, campaign.holdings ?? []) &&
  [campaign.castleCatalog ?? [], campaign.castleEstimates ?? []].every(items => new Set(items.map(item => item.id)).size === items.length) &&
  new Set(campaign.events.map(event => event.id)).size === campaign.events.length &&
  campaign.events.every(event => event.rule?.weekdays.every(day => day < campaign.calendar.weekdays.length) ?? true),
'Campaign events and domain history must be valid')
const storeSchema = z.object({
  version: z.literal(1), active: name,
  campaigns: z.array(campaignSchema).min(1),
}).refine(store => store.campaigns.some(c => c.id === store.active) && new Set(store.campaigns.map(c => c.id)).size === store.campaigns.length, 'Invalid campaign selection')
const backupSchema = z.object({ version: z.literal(1), campaign: campaignSchema })

export const key = 'campaign-calendar:v1'
export function newCampaign(name: string, calendar = template(), current = 0): Campaign {
  return { id: crypto.randomUUID(), name, calendar, current, events: [] }
}

export const parseStore = (text: string): Store => storeSchema.parse(JSON.parse(text))
export const exportCampaign = (campaign: Campaign) => JSON.stringify({ version: 1, campaign }, null, 2)

export function parseCampaignBackup(text: string): Campaign {
  const value: unknown = JSON.parse(text)
  if (typeof value === 'object' && value !== null && 'campaigns' in value && !('campaign' in value)) {
    const old = storeSchema.parse(value)
    return old.campaigns.find(item => item.id === old.active)!
  }
  return backupSchema.parse(value).campaign
}

export function restoreActiveCampaign(store: Store, backup: Campaign): Store {
  return { ...store, campaigns: store.campaigns.map(item => item.id === store.active ? { ...backup, id: item.id } : item) }
}

export function deleteActiveCampaign(store: Store): Store {
  const campaigns = store.campaigns.filter(item => item.id !== store.active)
  if (!campaigns.length) campaigns.push(newCampaign('Example Campaign'))
  return { ...store, active: campaigns[0].id, campaigns }
}

export function saveStore(storage: Storage, store: Store) {
  storage.setItem(key, JSON.stringify(storeSchema.parse(store)))
}

export function saveIfCurrent(storage: Pick<Storage, 'getItem' | 'setItem'>, expected: string | null, next: Store) {
  const current = storage.getItem(key)
  if (current !== expected) return { saved: false as const, raw: current }
  const raw = JSON.stringify(storeSchema.parse(next))
  storage.setItem(key, raw)
  return { saved: true as const, raw }
}
