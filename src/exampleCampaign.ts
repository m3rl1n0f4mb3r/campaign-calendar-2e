import { dateIndex, template, type Calendar } from './calendar'
import { initialConfidence, recordCheck } from './confidence'
import { applyProjectEstimate, newProject, postWork, recordProjectReview } from './construction'
import { availableEffects, closingDay, nextMonth, recordTurn, territoryDefaults, turnEstimates, type Holding, type Territory, type TurnMonth } from './domain'
import { applyConsequence, saveEngagement, type Engagement } from './engagement'
import { approveEstimate, defaultCatalog, newEstimate } from './estimate'
import { minutes, type Series } from './events'
import { militaryCharges } from './military'
import { approveResolution, defaultForce, resolutionSummary, resolveStep, storeResolution, type Resolution } from './quickResolution'
import type { Campaign } from './storage'

function valeCalendar(): Calendar {
  const calendar = template()
  const festivals = {
    3: { id: 'seedfair', name: 'Seedfair', days: 4, festival: true },
    6: { id: 'lanternwake', name: 'Lanternwake', days: 5, festival: true },
    9: { id: 'harvestfair', name: 'Harvest Fair', days: 4, festival: true },
    12: { id: 'longnight', name: 'Long Night', days: 3, festival: true },
  }
  return {
    ...calendar, after: 'VR', before: 'BVR',
    weekdays: ['Firstday', 'Clayday', 'Brookday', 'Marketday', 'Greenday', 'Stoneday', 'Restday'],
    periods: ['Snowmelt', 'Raincall', 'Seedtime', 'Blossom', 'Meadow', 'Suncrest', 'Highsummer', 'Goldleaf',
      'Reapfall', 'Mistfall', 'Frostwane', 'Deepwinter'].flatMap((name, i) => {
      const period = { id: `month-${i + 1}`, name, days: 30, festival: false }
      const festival = festivals[(i + 1) as keyof typeof festivals]
      return festival ? [period, festival] : [period]
    }),
    moons: [
      { name: 'Pearl', cycle: 30, anchor: 0, phase: 4, color: '#536b91', source: 'Example Campaign moon' },
      { name: 'Ember', cycle: 18, anchor: 3, phase: 6, color: '#a64d36', source: 'Example Campaign moon' },
      { name: 'Wisp', cycle: 9, anchor: 1, phase: 2, color: '#685388', source: 'Example Campaign moon' },
    ],
  }
}

const first: TurnMonth = { year: 0, period: 'month-7' }
const territory = (id: string, name: string, families: number, resource: string, type: Territory['resources'][number]['type'], settlement: Territory['settlement']): Territory =>
  ({ id, name, families, settlement, resources: [{ name: resource, type }] })

function holding(id: string, name: string, ruler: string, territories: Territory[]): Holding {
  return { id, name, ruler, liege: 'The Alder Vale Council', first, families: territories.reduce((sum, land) => sum + land.families, 0),
    resources: [], territories, tax: 100, services: 1000, opening: { cash: 250_000, noncash: 0 },
    titheRate: 1000, xpMode: 'pc', turns: [], replay: [] }
}

function festivalEvents(calendar: Calendar): Series[] {
  return [
    ['lanternwake', 'Lantern boats on the river', 'Rivergate', 'Families light boats at dusk to thank the ferrymen.', '#955b30'],
    ['harvestfair', 'Alder Vale Harvest Fair', 'Willowbank', 'Farmers trade seed, cider and wool before the weather turns.', '#806027'],
    ['longnight', 'Long Night feast', 'Lantern Hall', 'The hall serves a hot meal to travellers and neighbours.', '#674a83'],
    ['seedfair', 'Spring seed exchange', 'Stoneford', 'The four holdings trade seed and tools for the coming season.', '#4c7650'],
  ].map(([period, title, location, notes, color]) => {
    const start = dateIndex(calendar, { year: 0, period, day: 1 })
    return { id: period, title, location, notes, color, start: start * minutes, end: (start + 1) * minutes, allDay: true, exceptions: {},
      rule: { frequency: 'yearly', interval: 1, weekdays: [], festival: 'festival' } }
  })
}

export function exampleCampaign(): Campaign {
  const calendar = valeCalendar()
  const day = (year: number, month: number, day: number) => dateIndex(calendar, { year, period: `month-${month}`, day })
  const rivergate = holding('rivergate', 'Rivergate', 'Elin Reed', [
    territory('quays', 'Rivergate Quays', 140, 'River fish', 'animal', 'civilized'),
    territory('banks', 'Reedbank Farms', 55, 'Barley', 'vegetable', 'borderland'),
  ])
  const willowbank = holding('willowbank', 'Willowbank', 'Tamsin Vale', [
    territory('orchard', 'Willow Orchard', 110, 'Apples', 'vegetable', 'civilized'),
    territory('meadow', 'South Meadow', 70, 'Wool', 'animal', 'borderland'),
  ])
  const stoneford = holding('stoneford', 'Stoneford', 'Marek Ash', [
    territory('ridge', 'Ash Ridge', 90, 'Limestone', 'mineral', 'borderland'),
  ])
  const lantern = holding('lantern', 'Lantern Hall', 'Nessa Flint', [
    territory('grove', 'Lantern Grove', 95, 'Herbs', 'vegetable', 'borderland'),
  ])
  const event = (id: string, title: string, when: number, location: string, notes: string, color: string, days = 1): Series =>
    ({ id, title, location, notes, color, start: when * minutes, end: (when + days) * minutes, allDay: true, exceptions: {} })

  const market = event('market', 'Rivergate market', day(0, 7, 5), 'Rivergate Quays', 'Bakers, fishers and travelling repairers set up stalls beside the ferry.', '#557854')
  market.rule = { frequency: 'monthly', interval: 1, weekdays: [], festival: 'previous' }
  const bridgeOpening = event('bridge-opening', 'Rivergate Bridge Reopens', day(1, 7, 12), 'Rivergate',
    'A year after the four rulers agreed to keep the river route open, the repaired bridge welcomes traders and travellers again. Join the first crossing at noon.', '#aa522b')
  bridgeOpening.allDay = false
  bridgeOpening.start += 12 * 60
  bridgeOpening.end = bridgeOpening.start + 90
  let campaign: Campaign = { id: 'example-alder-vale', name: 'Example Campaign', calendar, current: day(1, 7, 12),
    holdings: [rivergate, willowbank, stoneford, lantern],
    events: [...festivalEvents(calendar), market,
      event('council', 'Four rulers at the ferry', day(0, 7, 12), 'Rivergate', 'Elin, Tamsin, Marek and Nessa agree to share the cost of keeping the river route open.', '#536b91'),
      event('stone', 'First stone laid at the ferry', day(0, 8, 18), 'Rivergate', 'Stoneford supplies limestone for the new riverside wall.', '#806027'),
      event('ferry', 'Ferry service resumes', day(1, 2, 22), 'Rivergate Quays', 'The ferry reopens after the spring flood. Heavy wagons are still routed through Stoneford.', '#466a8c'),
      event('bridge-inspection', 'Bridge safety walk', day(1, 7, 8), 'East Bridge', 'Marek walks the repaired crossing with the masons before it opens to wagons.', '#536b91'),
      bridgeOpening,
      event('trade-returns', 'The first merchant wagons cross', day(1, 7, 14), 'East Bridge', 'The road to Stoneford is open again. Rivergate ends the temporary ferry detour.', '#806027'),
      event('picnic', 'Riverside picnic', day(1, 7, 17), 'Reedbank Farms', 'Willowbank brings cider and Lantern Hall brings bread for a picnic by the river.', '#674a83'),
      event('year-review', 'Alder Vale council meeting', day(1, 7, 24), 'Lantern Hall', 'The four rulers review a year of work and agree who will look after the crossing next.', '#466a8c'),
    ] }
  rivergate.military = { units: [{
    id: 'river-guard', name: 'River Guard', type: 'Infantry', changes: [
      { id: 'guard-muster', kind: 'muster', day: day(0, 7, 1), strength: 24, location: 'Rivergate', notes: 'Mustered to patrol the ferry road.',
        terms: { service: 'paid', rateType: 'troop', rate: 200 } },
      { id: 'guard-deploy', kind: 'deployment', day: day(1, 3, 12), location: 'East Bridge', billing: 'home', notes: 'The guard joins the defence of the eastern approach.' },
      { id: 'guard-return', kind: 'return', day: day(1, 5, 3), location: 'Rivergate Quays', notes: 'The relief watch takes over at the bridge.' },
    ],
  }], supplies: [] }
  stoneford.military = { units: [{
    id: 'ridge-watch', name: 'Ridge Watch', type: 'Levy', changes: [
      { id: 'watch-muster', kind: 'muster', day: day(0, 10, 5), strength: 16, location: 'Ash Ridge', notes: 'Local families provide a rotating watch.',
        terms: { service: 'obligation', rateType: 'unit', rate: 0 } },
    ],
  }], supplies: [] }

  const base = { ...initialConfidence(), base: 270, current: 270 }
  willowbank.confidence = recordCheck({ ...base, events: [
    { id: 'willow-flood', title: 'Flood at Willow Orchard', day: day(1, 2, 9), disaster: true, status: 'resolved',
      resolvedDay: day(1, 2, 11), notes: 'The orchard loses part of its early crop. Nessa sends grain while the roads dry.' },
  ], effects: [{
    id: 'lost-fruit', source: 'willow-flood', title: 'Flood damage to the orchard', target: { year: 1, period: 'month-2' },
    category: 'resource', balance: 'noncash', amount: -2_500,
  }] }, { id: 'flood-review', day: day(1, 2, 11), eventId: 'willow-flood', trigger: 'disaster', notes: 'Relief arrived before the ferry reopened.',
    modifier: 0, change: -4 })

  const module = defaultCatalog().find(item => item.id === 'wall-stone')!
  const estimate = { ...newEstimate(), id: 'ferry-wall-estimate', name: 'Ferry wall', duration: 400,
    lines: [{ id: 'ferry-wall-line', module, description: module.name, unit: module.unit, quantity: 200, cost: module.cost, labor: module.labor }] }
  const start = day(0, 8, 18)
  let project = applyProjectEstimate({ ...newProject(calendar, start), id: 'ferry-wall', name: estimate.name },
    approveEstimate(estimate, calendar.weekdays.length, start, 'ferry-wall-approval'))
  for (const period of ['month-8', 'month-9']) {
    const month = { year: 0, period }
    const through = closingDay(calendar, month)
    project = recordProjectReview(calendar, project, through, { id: `wall-review-${period}`, month, roll: 42, notes: 'Work continued as scheduled.' }, false)
    project = postWork(calendar, project, through, start, through)
  }
  project.costs = [
    { id: 'wall-materials', source: project.id, title: 'Stone and mortar', target: { year: 0, period: 'month-8' }, category: 'general', balance: 'cash', amount: -60_000 },
    { id: 'wall-labor', source: project.id, title: 'Masons and finishing work', target: { year: 0, period: 'month-9' }, category: 'general', balance: 'cash', amount: -50_000 },
  ]
  rivergate.projects = [project]
  campaign.castleEstimates = [estimate]

  const siegeStart = day(1, 3, 12)
  const engagement: Engagement = { id: 'east-bridge-siege', kind: 'siege', title: 'Siege at East Bridge', start: siegeStart, location: 'East Bridge',
    holdingId: rivergate.id, participants: [
      { id: 'siege-guard', name: 'River Guard', side: 'Vale Council', role: 'defender', holdingId: rivergate.id, unitId: 'river-guard', before: 24, after: 21 },
      { id: 'siege-company', name: 'Red Banner Company', side: '', role: 'attacker' },
    ], outcome: '', notes: 'The company took the eastern gate to demand payment for passage. The Vale Council kept the ferry operating upstream.', consequences: [] }
  campaign = saveEngagement(campaign, engagement)
  let resolution: Resolution = { id: 'east-bridge-resolution', engagementId: engagement.id, title: engagement.title, kind: 'siege', start: siegeStart,
    rules: 'DMGR2 chapter 8 v1', forces: { a: { ...defaultForce('Red Banner Company'), points: 150 }, b: defaultForce('River Guard') }, steps: [] }
  resolution = resolveStep(resolution, { kind: 'phase', day: siegeStart, roll: 65 })
  const siegeEnd = siegeStart + 41
  resolution = resolveStep(resolution, { kind: 'phase', day: siegeEnd, roll: 100 })
  const recordedAt = storeResolution({ ...campaign, current: siegeEnd }, resolution)
  const resolved = approveResolution(recordedAt, resolution, resolutionSummary(resolution), '', engagement.id,
    'The River Guard surrendered the gate. Elin negotiated safe passage for the garrison. The company later withdrew after the council reached an agreement on river tolls.')
  campaign = { ...resolved, current: campaign.current }
  const recorded = campaign.engagements![0]
  campaign = saveEngagement(campaign, { ...recorded, consequences: [
    { id: 'bridge-loss', kind: 'troops', status: 'proposed', holdingId: rivergate.id, unitId: 'river-guard', day: siegeEnd, strength: 24, delta: -3 },
    { id: 'bridge-repair', kind: 'expense', status: 'proposed', holdingId: rivergate.id, day: siegeEnd,
      title: 'Emergency bridge repairs', amount: 18_000, balance: 'cash' },
  ] })
  campaign = applyConsequence(applyConsequence(campaign, engagement.id, 'bridge-loss'), engagement.id, 'bridge-repair')

  return { ...campaign, holdings: campaign.holdings!.map(item => fiscalYear(calendar, item)) }
}

function fiscalYear(calendar: Calendar, start: Holding) {
  let holding = start
  let month = start.first
  for (let offset = 0; offset < 12; offset++) {
    const draft = territoryDefaults(holding)
    draft.effectIds = availableEffects(holding, month).map(effect => effect.id)
    const charges = militaryCharges(calendar, holding, month)
    if (charges.length) draft.military = { decisions: charges.map(charge => ({
      charge, action: offset === 0 ? 'defer' : 'pay', amount: charge.amount ?? 4_200,
    })) }
    const totals = turnEstimates(draft, holding, month)
    if (draft.payments?.liege && totals.liege) draft.payments.liege = { ...draft.payments.liege, approved: true, noncash: totals.liege.suggested }
    if (draft.payments?.tithe && totals.tithe) draft.payments.tithe = { ...draft.payments.tithe, approved: true, noncash: totals.tithe.suggested }
    if (draft.xp) draft.xp.approved = true
    holding = recordTurn(calendar, closingDay(calendar, month), holding, month, draft)
    month = nextMonth(calendar, month)
  }
  return holding
}
