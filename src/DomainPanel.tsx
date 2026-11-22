import { useState } from 'react'
import { dateLabel, displayYear } from './calendar'
import { closingDay, dueMonth, formatGp, monthAt, territoryPopulation, previewTurn, recordTurn, reopenTurn, resourceRates, sameMonth, territoriesFor, territoryDefaults, replayInputs, turnEstimates, paymentLabels, availableEffects,
  type Holding, type LedgerLine, type Payment, type PaymentKind, type Receipt, type Territory, type TerritoryTurn, type TurnInputs, type TurnMonth } from './domain'
import { ConfidencePanel } from './ConfidencePanel'
import type { Campaign } from './storage'

export type ReceiptLink = { holdingId: string; month: TurnMonth }
type Props = {
  campaign: Campaign
  revision: string | null
  receipt?: ReceiptLink
  dominionEvent?: { holdingId: string; id: string }
  save: (holdings: Holding[]) => Promise<boolean>
  backup: () => void
}
type Screen =
  | { type: 'confidence'; id: string; selectedEvent?: string }
  | { type: 'holding'; draft: Holding; revision: Props['revision'] }
  | { type: 'preview'; id: string; month: TurnMonth; draft: TurnInputs; revision: Props['revision']; reset?: boolean }
  | { type: 'receipt'; link: ReceiptLink }
  | { type: 'reopen'; link: ReceiptLink; revision: Props['revision'] }

function Money({ label, value, change, optional = false }: {
  label: string; value?: number; change: (value?: number) => void; optional?: boolean
}) {
  return <label>{label}<input type="number" step=".01" min="0" required={!optional}
    value={value === undefined ? '' : value / 100} onChange={event => change(event.target.value === '' ? undefined : Math.round(event.target.valueAsNumber * 100))}/></label>
}

function Rates({ values, change }: { values: Pick<TurnInputs, 'tax' | 'services'>; change: (values: Pick<TurnInputs, 'tax' | 'services'>) => void }) {
  return <div className="form-row">
      <Money label="Tax per family (gp)" value={values.tax} change={tax => change({ ...values, tax: tax ?? 0 })}/>
      <Money label="Services per family (gp equivalent)" value={values.services} change={services => change({ ...values, services: services ?? 0 })}/>
    </div>
}

function Resources({ resources, change }: { resources: Territory['resources']; change: (resources: Territory['resources']) => void }) {
  return <fieldset><legend>Resources</legend>
      {resources.map((resource, index) => {
        const update = (patch: Partial<typeof resource>) => change(resources.map((item, i) => i === index ? { ...item, ...patch } : item))
        return <div className="domain-fields domain-line" key={index}>
          <label>Name<input value={resource.name} required maxLength={120} onChange={e => update({ name: e.target.value })}/></label>
          <label>Type<select value={resource.type} onChange={e => update({ type: e.target.value as typeof resource.type })}>
            {Object.keys(resourceRates).map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Rate override (gp per family)<input type="number" min="0" step=".01" value={resource.rate === undefined ? '' : resource.rate / 100}
            placeholder={String(resourceRates[resource.type] / 100)}
            onChange={e => update({ rate: e.target.value === '' ? undefined : Math.round(e.target.valueAsNumber * 100) })}/></label>
          <button type="button" onClick={() => change(resources.filter((_, i) => i !== index))}>Remove resource</button>
        </div>
      })}
      <button type="button" onClick={() => change([...resources, { name: '', type: 'animal' }])}>Add resource</button>
  </fieldset>
}

function Families({ label, count, change }: { label: string; count: number; change: (families: number) => void }) {
  return <label>{label}<input type="number" min="0" step="1" required value={count} onChange={e => change(+e.target.value)}/></label>
}

function territoryName(item: Territory) {
  return item.externalId ? `${item.name} (${item.externalId})` : item.name
}

function TerritorySetup({ items, change }: { items: Territory[]; change: (territories: Territory[]) => void }) {
  return <fieldset className="form"><legend>Territories</legend>
    {items.map(item => {
      const update = (patch: Partial<Territory>) => change(items.map(other => other.id === item.id ? { ...other, ...patch } : other))
      return <section className="domain-holding form" key={item.id}>
        <div className="domain-fields">
          <label>Territory name<input required maxLength={120} value={item.name} onChange={e => update({ name: e.target.value })}/></label>
          <label>External hex ID<input maxLength={120} value={item.externalId ?? ''} onChange={e => update({ externalId: e.target.value || undefined })}/></label>
          <label>Settlement type<select value={item.settlement} onChange={e => update({ settlement: e.target.value as Territory['settlement'] })}>
            <option value="civilized">Civilized</option><option value="borderland">Borderland</option><option value="wilderness">Wilderness</option>
          </select></label>
          <Families label="Families" count={item.families} change={families => update({ families })}/>
        </div>
        <Resources resources={item.resources} change={resources => update({ resources })}/>
        <button type="button" disabled={items.length === 1} onClick={() => change(items.filter(other => other.id !== item.id))}>Remove territory</button>
      </section>
    })}
    <button type="button" onClick={() => change([...items, {
      id: crypto.randomUUID(), name: '', settlement: 'wilderness', families: 0, resources: [],
    }])}>Add territory</button>
  </fieldset>
}

function TurnTerritories({ items, saved, result, change }: {
  items: TerritoryTurn[]; saved?: TerritoryTurn[]; result?: Receipt['territories']; change: (territories: TerritoryTurn[]) => void
}) {
  return <fieldset className="form"><legend>Population and resources by territory</legend>
    {items.map(item => {
      const update = (patch: Partial<TerritoryTurn>) => change(items.map(other => other.id === item.id ? { ...other, ...patch } : other))
      const { rate, suggested, closing } = territoryPopulation(item)
      const previousOverride = saved?.find(previous => previous.id === item.id)?.override
      const production = result?.find(summary => summary.id === item.id)?.production
      const roll = (sign: -1 | 1) => {
        const die = 1 + Math.floor(Math.random() * 10)
        update({ adjustment: die * sign, roll: { die, sign } })
      }
      return <section className="domain-holding form" key={item.id}>
        <h4>{territoryName(item)}</h4>
        <p>{item.settlement} · {item.families} opening families</p>
        {item.families > 500 && <label>Growth rate (%)<input type="number" min="1" max="5" step="any" required value={item.largeRate} onChange={e => update({ largeRate: +e.target.value })}/></label>}
        <label className="check"><input type="checkbox" checked={item.applyGrowth} onChange={e => update({ applyGrowth: e.target.checked })}/> Apply suggested growth of {suggested} families ({rate}%)</label>
        <div className="form-row">
          <label>Family adjustment<input type="number" step="1" required value={item.adjustment} onChange={e => update({ adjustment: +e.target.value, roll: undefined })}/></label>
          <label>Closing families override<input type="number" min="0" step="1" value={item.override ?? ''} onChange={e => update({ override: e.target.value === '' ? undefined : +e.target.value })}/></label>
        </div>
        <div className="button-group">
          <button type="button" onClick={() => roll(1)}>Roll d10 gain</button>
          <button type="button" onClick={() => roll(-1)}>Roll d10 loss</button>
          {previousOverride !== undefined && <button type="button" onClick={() => update({ override: previousOverride })}>Reuse saved override ({previousOverride})</button>}
        </div>
        {item.roll && <p className="muted">d10 rolled {item.roll.die} for a {item.roll.sign > 0 ? 'gain' : 'loss'}.</p>}
        <p><strong>{closing} closing families</strong>{production !== undefined && ` · ${formatGp(production)} resource value`}</p>
        <Resources resources={item.resources} change={resources => update({ resources })}/>
      </section>
    })}
  </fieldset>
}

function Percent({ label, value, change }: { label: string; value: number; change: (rate: number) => void }) {
  return <label>{label}<input type="number" min="0" max="100" step=".01" required value={value / 100}
    onChange={event => change(Math.round(Number(event.target.value) * 100))}/></label>
}

function PaymentReview({ kind, value, estimate, previous, change }: {
  kind: PaymentKind; value: Payment; estimate?: NonNullable<Receipt['review']>[PaymentKind]
  previous?: Payment; change: (payment: Payment) => void
}) {
  const label = paymentLabels[kind]
  const edit = (patch: Partial<Payment>) => change({ ...value, ...patch, approved: false })
  return <fieldset className="form"><legend>{label}</legend>
    <Percent label={`${label} rate (%)`} value={value.rate} change={rate => edit({ rate })}/>
    <label className="check"><input type="checkbox" checked={value.includeTribute}
      onChange={e => edit({ includeTribute: e.target.checked })}/> Include incoming tribute in {label.toLowerCase()} calculation</label>
    {estimate && <p>Suggested <strong>{formatGp(estimate.suggested)}</strong> ({estimate.rate / 100}% of {formatGp(estimate.basis)}).</p>}
    {previous?.approved && <p className="muted">Previously approved: {formatGp(previous.cash)} cash · {formatGp(previous.noncash)} noncash.</p>}
    {!!estimate?.manual && <p className="warning">The ledger already includes {formatGp(estimate.manual)} in manually entered {label.toLowerCase()} debits.</p>}
    {estimate && <div className="button-group">
      <button type="button" onClick={() => edit({ cash: estimate.suggested, noncash: 0 })}>Use suggestion as cash</button>
      <button type="button" onClick={() => edit({ cash: 0, noncash: estimate.suggested })}>Use suggestion as noncash</button>
    </div>}
    <div className="form-row">
      <Money label={`${label} cash (gp)`} value={value.cash} change={cash => edit({ cash: cash ?? 0 })}/>
      <Money label={`${label} noncash (gp)`} value={value.noncash} change={noncash => edit({ noncash: noncash ?? 0 })}/>
    </div>
    <label className="check"><input type="checkbox" checked={value.approved} disabled={!estimate}
      onChange={e => change({ ...value, approved: e.target.checked })}/> Approve {label.toLowerCase()} of {formatGp(value.cash + value.noncash)}</label>
  </fieldset>
}

function estimateReview(draft: TurnInputs, holding: Holding, month: TurnMonth) {
  try { return turnEstimates(draft, holding, month) }
  catch { return undefined }
}

function Ledger({ turn }: { turn: Receipt }) {
  return <div className="grid-scroll"><table className="ledger">
    <thead><tr><th scope="col">Entry</th><th scope="col">Cash</th><th scope="col">Noncash value</th></tr></thead>
    <tbody>
      <tr><th scope="row">Opening balance</th><td>{formatGp(turn.opening.cash)}</td><td>{formatGp(turn.opening.noncash)}</td></tr>
      {turn.lines.map((line, index) => <tr key={index}><th scope="row">{line.name}</th>
        <td>{line.balance === 'cash' ? formatGp(line.amount) : '—'}</td>
        <td>{line.balance === 'noncash' ? formatGp(line.amount) : '—'}</td>
      </tr>)}
    </tbody>
    <tfoot><tr><th scope="row">Closing balance</th><td>{formatGp(turn.closing.cash)}</td><td>{formatGp(turn.closing.noncash)}</td></tr></tfoot>
    <caption>Gross income {formatGp(turn.gross)} equivalent</caption>
  </table></div>
}

export function DomainPanel({ campaign, revision, receipt, dominionEvent, save, backup }: Props) {
  const [screen, setScreen] = useState<Screen | undefined>(receipt ? { type: 'receipt', link: receipt } : dominionEvent ? { type: 'confidence', id: dominionEvent.holdingId, selectedEvent: dominionEvent.id } : undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const { calendar, current } = campaign
  const holdings = campaign.holdings ?? []
  const date = (month: TurnMonth) => dateLabel(calendar, closingDay(calendar, month))
  const go = (next?: Screen) => { setError(''); setScreen(next) }
  const stale = !!(screen && 'revision' in screen && screen.revision !== revision)
  const persist = async (holding: Holding, next?: Screen) => {
    setPending(true)
    try {
      const updated = holdings.some(item => item.id === holding.id)
        ? holdings.map(item => item.id === holding.id ? holding : item)
        : [...holdings, holding]
      if (await save(updated)) go(next)
    } finally { setPending(false) }
  }
  const startPreview = (holding: Holding) => {
    const month = dueMonth(calendar, holding)
    go({ type: 'preview', id: holding.id, month, draft: replayInputs(holding, month), revision })
  }
  const startHolding = (holding?: Holding) => go({ type: 'holding', revision, draft: holding ?? {
    id: crypto.randomUUID(), name: '', ruler: '', liege: '', first: monthAt(calendar, current),
    opening: { cash: 0, noncash: 0 }, families: 0, tax: 100, services: 1000, resources: [], territories: [{ id: crypto.randomUUID(), name: 'Core territory', settlement: 'wilderness', families: 0, resources: [] }], turns: [], replay: [],
  } })
  const back = <button type="button" onClick={() => go()}>Back to holdings</button>

  if (screen?.type === 'confidence') {
    const holding = holdings.find(item => item.id === screen.id)
    if (!holding) return <div className="form"><p>This holding is no longer available.</p>{back}</div>
    return <ConfidencePanel calendar={calendar} clock={current} holding={holding} revision={revision}
      selectedEvent={screen.selectedEvent} back={() => go()}
      openReceipt={month => go({ type: 'receipt', link: { holdingId: holding.id, month } })}
      reopen={month => go({ type: 'reopen', link: { holdingId: holding.id, month }, revision })}
      save={next => save(holdings.map(item => item.id === next.id ? next : item))}/>
  }

  if (screen?.type === 'holding') {
    const { draft } = screen
    const change = (patch: Partial<Holding>) => setScreen({ ...screen, draft: { ...draft, ...patch } })
    const year = displayYear(calendar, draft.first.year)
    const openingEditable = draft.turns.length === 0
    return <form className="form" onSubmit={e => {
      e.preventDefault()
      if (stale || pending) return
      const territories = territoriesFor(draft)
      const families = territories.reduce((sum, item) => sum + item.families, 0)
      void persist({ ...draft, territories, families, resources: territories.length === 1 ? territories[0].resources : [] })
    }}>
      <h3>{holdings.some(item => item.id === draft.id) ? 'Edit holding' : 'New holding'}</h3>
      {stale && <p role="alert" className="warning">Campaign data changed. Return to holdings and reopen the editor.</p>}
      <div className="domain-fields">
        <label>Holding name<input required maxLength={120} value={draft.name} onChange={e => change({ name: e.target.value })}/></label>
        <label>Ruler<input required maxLength={120} value={draft.ruler} onChange={e => change({ ruler: e.target.value })}/></label>
        <label>Liege<input maxLength={120} value={draft.liege} onChange={e => change({ liege: e.target.value })}/></label>
      </div>
      <Rates values={draft} change={change}/>
      <fieldset className="form"><legend>Obligations and rulership XP</legend>
        {draft.liege.trim() && <Percent label="Default liege rate (%)" value={draft.liegeRate ?? 2000} change={liegeRate => change({ liegeRate })}/>}
        <label className="check"><input type="checkbox" checked={draft.titheRate !== undefined}
          onChange={e => change({ titheRate: e.target.checked ? 1000 : undefined })}/> Suggest a tithe</label>
        {draft.titheRate !== undefined && <Percent label="Default tithe rate (%)" value={draft.titheRate} change={titheRate => change({ titheRate })}/>}
        <label>Ruler XP tracking<select value={draft.xpMode ?? 'off'} onChange={e => change({ xpMode: e.target.value as Holding['xpMode'] })}>
          <option value="off">No XP tracking</option><option value="pc">Player character (PC)</option><option value="npc">Nonplayer character (NPC)</option>
        </select></label>
      </fieldset>
      <TerritorySetup items={territoriesFor(draft)} change={territories => change({ territories })}/>
      {openingEditable && <>
        <fieldset><legend>First month to close</legend><div className="form-row">
          <label>Month<select value={draft.first.period} onChange={e => change({ first: { ...draft.first, period: e.target.value } })}>
            {calendar.periods.filter(item => !item.festival).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Year<input type="number" required min="-99999" max="99999" defaultValue={year}
            onChange={e => {
              const value = e.target.valueAsNumber
              e.target.setCustomValidity(calendar.skipZero && value === 0 ? 'This calendar skips year zero.' : '')
              if (Number.isInteger(value) && !(calendar.skipZero && value === 0)) change({ first: { ...draft.first, year: value - Number(calendar.skipZero && value > 0) } })
            }}/></label>
        </div><p className="muted">The preview uses a full month. Enter a ledger adjustment for a partial month.</p></fieldset>
        <div className="form-row">
          <Money label="Opening cash (gp)" value={draft.opening.cash} change={cash => change({ opening: { ...draft.opening, cash: cash ?? 0 } })}/>
          <Money label="Opening noncash value (gp)" value={draft.opening.noncash} change={noncash => change({ opening: { ...draft.opening, noncash: noncash ?? 0 } })}/>
        </div>
      </>}
      <div className="actions">{back}<button className="primary" disabled={pending || stale}>Save holding</button></div>
    </form>
  }

  if (screen?.type === 'preview') {
    const holding = holdings.find(item => item.id === screen.id)
    if (!holding) return <div className="form"><p>This holding is no longer available.</p>{back}</div>
    const { draft, month } = screen
    const replay = screen.reset ? undefined : holding.replay.find(item => sameMonth(item.month, month))
    const saved = replay?.inputs.territories
    const estimates = stale ? undefined : estimateReview(draft, holding, month)
    const currentTerritories = territoriesFor(holding)
    const historicalOnly = draft.territories?.filter(item => !currentTerritories.some(current => current.id === item.id)) ?? []
    const currentOnly = draft.territories ? currentTerritories.filter(item => !draft.territories?.some(historical => historical.id === item.id)) : []
    const changedSetup = draft.territories?.filter(item => currentTerritories.some(current => current.id === item.id &&
      (current.name !== item.name || (current.externalId ?? '') !== (item.externalId ?? '') || current.settlement !== item.settlement ||
       current.resources.length !== item.resources.length || current.resources.some((resource, index) => {
         const previous = item.resources[index]
         return !previous || previous.name !== resource.name || previous.type !== resource.type ||
           (resource.rate ?? resourceRates[resource.type]) !== (previous.rate ?? resourceRates[previous.type])
       })))) ?? []
    const change = (patch: Partial<TurnInputs>) => {
      const next = { ...draft, ...patch }
      if (draft.xp?.approved || draft.payments?.liege?.approved || draft.payments?.tithe?.approved) {
        const updated = estimateReview(next, holding, month)
        for (const kind of ['liege', 'tithe'] as const) {
          const payment = next.payments?.[kind]
          if (payment?.approved && JSON.stringify(updated?.[kind]) !== JSON.stringify(estimates?.[kind])) {
            next.payments = { ...next.payments, [kind]: { ...payment, approved: false } }
          }
        }
        if (next.xp?.approved && updated?.xp?.basis !== estimates?.xp?.basis) next.xp = { ...next.xp, approved: false }
      }
      setScreen({ ...screen, draft: next })
    }
    let result: Receipt | undefined
    let invalid = ''
    if (!stale) {
      try { result = previewTurn(holding, month, draft) }
      catch (cause) { invalid = cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Complete all required ledger fields with valid amounts.' }
    }
    const addLine = (name: string, balance: LedgerLine['balance']) =>
      change({ adjustments: [...draft.adjustments, { name, balance, amount: -0 }] })
    return <form className="form" onSubmit={e => {
      e.preventDefault()
      if (!result || stale || pending) return
      try {
        const updated = recordTurn(calendar, current, holding, month, draft)
        void persist(updated, { type: 'receipt', link: { holdingId: holding.id, month } })
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record the turn.') }
    }}>
      <h3>{holding.name}{!stale && ` · ${date(month)}`}</h3>
      {stale ? <div className="warning" role="alert">This preview is stale. Refresh to use the latest ledger and campaign date.</div> : <>
        <button type="button" onClick={() => setScreen({ ...screen, draft: territoryDefaults(holding), reset: true })}>Reset to current defaults</button>
        <Rates values={draft} change={change}/>
        {draft.territories ? <>
          {(historicalOnly.length > 0 || currentOnly.length > 0 || changedSetup.length > 0) && saved && <div className="warning">
            {historicalOnly.length > 0 && <p>Only in this turn: {historicalOnly.map(territoryName).join(', ')}.</p>}
            {currentOnly.length > 0 && <p>Only in the current holding: {currentOnly.map(territoryName).join(', ')}.</p>}
            {changedSetup.length > 0 && <p>Territory details or resources differ: {changedSetup.map(territoryName).join(', ')}.</p>}
          </div>}
          <TurnTerritories items={draft.territories} saved={saved} result={result?.territories} change={territories => change({ territories })}/>
        </> : <>
          <p className="muted">This reopened turn uses the original single-unit calculation.</p>
          <Families label="Families" count={draft.families} change={families => change({ families })}/>
          <Resources resources={draft.resources} change={resources => change({ resources })}/>
        </>}
        <div className="form-row">
          <Money label="Total resource value override (gp)" optional value={draft.override} change={override => change({ override })}/>
          <Money label="Resource value realized in cash (gp)" value={draft.realized} change={realized => change({ realized: realized ?? 0 })}/>
        </div>
        <fieldset><legend>Expenses and adjustments</legend>
          {draft.adjustments.map((line, index) => {
            const update = (patch: Partial<LedgerLine>) => change({ adjustments: draft.adjustments.map((item, i) => i === index ? { ...item, ...patch } : item) })
            const debit = line.amount < 0 || Object.is(line.amount, -0)
            return <div className="domain-fields domain-line" key={index}>
              <label>Entry<input required maxLength={120} value={line.name} onChange={e => update({ name: e.target.value })}/></label>
              <label>Balance<select value={line.balance} onChange={e => update({ balance: e.target.value as LedgerLine['balance'] })}><option value="cash">Cash</option><option value="noncash">Noncash</option></select></label>
              <label>Category<select value={line.category ?? ''} onChange={e => {
                const category = (e.target.value || undefined) as LedgerLine['category']
                const amount = category === 'tribute' ? Math.abs(line.amount)
                  : category ? -Math.abs(line.amount) : line.amount
                update({ category, amount })
              }}><option value="">General</option><option value="tribute">Incoming tribute</option><option value="liege">Liege payment</option><option value="tithe">Tithe</option></select></label>
              <label>Direction<select value={debit ? 'debit' : 'credit'} onChange={e => update({ amount: Math.abs(line.amount) * (e.target.value === 'debit' ? -1 : 1) })}><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
              <Money label="Amount (gp)" value={Math.abs(line.amount)} change={amount => update({ amount: (amount ?? 0) * (debit ? -1 : 1) })}/>
              <button type="button" onClick={() => change({ adjustments: draft.adjustments.filter((_, i) => i !== index) })}>Remove entry</button>
            </div>
          })}
          <div className="button-group"><button type="button" onClick={() => addLine('', 'cash')}>Add ledger entry</button><button type="button" onClick={() => addLine('Noncash expiration', 'noncash')}>Add expiration</button></div>
        </fieldset>
        {availableEffects(holding, month).length > 0 && <fieldset className="form"><legend>Approved event and confidence effects</legend>
          {availableEffects(holding, month).map(effect => <div key={effect.id}>
            <label className="check"><input type="checkbox" checked={draft.effectIds?.includes(effect.id) ?? false}
              onChange={e => change({ effectIds: e.target.checked ? [...(draft.effectIds ?? []), effect.id] : draft.effectIds?.filter(id => id !== effect.id) })}/>
              {effect.title} · {formatGp(effect.amount)} {effect.balance} · {effect.category}
            </label>
            {replay?.inputs.effectIds?.includes(effect.id) && <p className="muted">Applied in the original turn. Select to reapply.</p>}
          </div>)}
        </fieldset>}
        {(['liege', 'tithe'] as const).map(kind => {
          const payment = draft.payments?.[kind]
          return payment && <PaymentReview key={kind} kind={kind} value={payment} estimate={estimates?.[kind]}
            previous={replay?.inputs.payments?.[kind]} change={value => change({ payments: { ...draft.payments, [kind]: value } })}/>
        })}
        {draft.xp && <fieldset className="form"><legend>Rulership XP</legend>
          <p>{draft.xp.recipient} · {draft.xp.mode.toUpperCase()}</p>
          {estimates?.xp && <p>Suggested <strong>{estimates.xp.suggested.toLocaleString()} XP</strong> from {formatGp(estimates.xp.basis)} in taxes and resource income.</p>}
          {replay?.xpAward && <p className="muted">Previously approved: {replay.xpAward.amount.toLocaleString()} XP for {replay.xpAward.recipient}.</p>}
          <label>XP override<input type="number" min="0" step="1" value={draft.xp.override ?? ''}
            onChange={e => change({ xp: { ...draft.xp!, approved: false, override: e.target.value === '' ? undefined : +e.target.value } })}/></label>
          <label className="check"><input type="checkbox" checked={draft.xp.approved} disabled={!estimates?.xp}
            onChange={e => change({ xp: { ...draft.xp!, approved: e.target.checked } })}/> Approve XP award</label>
        </fieldset>}
        <label>Turn notes<textarea value={draft.notes} onChange={e => change({ notes: e.target.value })}/></label>
        {result ? <Ledger turn={result}/> : <p role="alert" className="warning">{invalid}</p>}
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions">{back}{stale ? <button type="button" onClick={() => closingDay(calendar, dueMonth(calendar, holding)) <= current ? startPreview(holding) : go()}>Refresh preview</button>
        : <button className="primary" disabled={pending || !result}>Record turn</button>}</div>
    </form>
  }

  if (screen?.type === 'receipt' || screen?.type === 'reopen') {
    const holding = holdings.find(item => item.id === screen.link.holdingId)
    const turn = holding?.turns.find(item => sameMonth(item.month, screen.link.month))
    if (!holding || !turn) return <div className="form"><p>This receipt is no longer available.</p>{back}</div>
    if (screen.type === 'reopen') {
      const next = reopenTurn(holding, turn.month)
      const affected = holding.turns.slice(next.turns.length)
      const restored = next.turns.at(-1)?.closing ?? holding.opening
      return <div className="form">
        <h3>Reopen turns for {holding.name}</h3>
        <p className="warning">These receipts and calendar entries will be cleared. Their original inputs will be available for replay.</p>
        <ul>{affected.map(item => <li key={date(item.month)}>{date(item.month)}</li>)}</ul>
        <p>Restored balances: {formatGp(restored.cash)} cash · {formatGp(restored.noncash)} noncash.</p>
        <p>Next turn closes {date(dueMonth(calendar, next))}.</p>
        {stale && <p className="warning" role="alert">This review is stale. Return to the receipt to review the latest ledger.</p>}
        <div className="actions"><button onClick={() => go({ type: 'receipt', link: screen.link })}>Back to receipt</button><button onClick={backup}>Download backup</button>
          <button className="danger" disabled={pending || stale} onClick={() => void persist(next)}>Confirm reopen</button></div>
      </div>
    }
    return <div className="form">
      <h3>{turn.name} · {date(turn.month)}</h3>
      <p>{turn.ruler}{turn.liege && ` · Liege: ${turn.liege}`}</p>
      <p>{turn.inputs.families} families · {formatGp(turn.inputs.tax)} tax per family · {formatGp(turn.inputs.services)} services per family</p>
      {turn.territories && <ul>{turn.territories.map(item => {
        const input = turn.inputs.territories?.find(territory => territory.id === item.id)
        return <li key={item.id}>{input ? territoryName(input) : item.id}: {item.opening} → {item.closing} families · {formatGp(item.production)} resources
          {input?.override !== undefined && ' · Closing count overridden'}
          {input?.roll && ` · d10 ${input.roll.die} (${input.roll.sign > 0 ? 'gain' : 'loss'})`}
        </li>
      })}</ul>}
      <Ledger turn={turn}/>
      {(['liege', 'tithe'] as const).map(kind => {
        const estimate = turn.review?.[kind]
        const payment = turn.inputs.payments?.[kind]
        return estimate && payment && <p key={kind}>{paymentLabels[kind]}: {formatGp(estimate.suggested)} suggested
          ({estimate.rate / 100}% of {formatGp(estimate.basis)}).
          {payment.approved && ` Approved ${formatGp(payment.cash)} cash and ${formatGp(payment.noncash)} noncash.`}
        </p>
      })}
      {turn.xpAward && <p><strong>{turn.xpAward.amount.toLocaleString()} XP</strong> awarded to {turn.xpAward.recipient}.</p>}
      {turn.inputs.notes && <p className="domain-notes">{turn.inputs.notes}</p>}
      <div className="actions">{back}<button onClick={() => go({ type: 'reopen', link: screen.link, revision })}>Reopen turn</button></div>
    </div>
  }

  return <div className="form">
    <div className="actions"><button className="primary" onClick={() => startHolding()}>Add holding</button></div>
    {holdings.length === 0 && <p>No holdings in this campaign.</p>}
    {holdings.map(holding => {
      const next = dueMonth(calendar, holding)
      const balance = holding.turns.at(-1)?.closing ?? holding.opening
      const xpTotals = new Map<string, bigint>()
      for (const { xpAward } of holding.turns) {
        if (xpAward) xpTotals.set(xpAward.recipient, (xpTotals.get(xpAward.recipient) ?? 0n) + BigInt(xpAward.amount))
      }
      return <section className="domain-holding" key={holding.id}>
        <h3>{holding.name}</h3>
        <p>{territoriesFor(holding).length} {territoriesFor(holding).length === 1 ? 'territory' : 'territories'} · {holding.families} families</p>
        <p>{formatGp(balance.cash)} cash · {formatGp(balance.noncash)} noncash</p>
        <p>Next turn closes {date(next)}.</p>
        <div className="button-group">
          <button onClick={() => startHolding(holding)}>Edit holding</button>
          <button onClick={() => go({ type: 'confidence', id: holding.id })}>Confidence and events</button>
          <button disabled={closingDay(calendar, next) > current} onClick={() => startPreview(holding)}>Preview turn</button>
        </div>
        {holding.turns.length > 0 && <details><summary>Turn history</summary>
          {[...xpTotals].map(([ruler, total]) => <p key={ruler}>{ruler} · {total.toLocaleString()} XP recorded for this holding</p>)}
          <ul>{[...holding.turns].reverse().map(turn => <li key={date(turn.month)}><button onClick={() => go({ type: 'receipt', link: { holdingId: holding.id, month: turn.month } })}>{date(turn.month)}</button>{turn.xpAward && ` · ${turn.xpAward.amount.toLocaleString()} XP for ${turn.xpAward.recipient}`}</li>)}</ul>
        </details>}
      </section>
    })}
    <details><summary>Rules used for monthly turns</summary>
      <p>Holding and feudal context follow <cite>The Castle Guide</cite>. Monthly income and expenses use the <cite>Rules Cyclopedia</cite>, chapter 12. Resource income uses the <cite>Companion Rules</cite>, Book Two, page 5.</p>
    </details>
  </div>
}
