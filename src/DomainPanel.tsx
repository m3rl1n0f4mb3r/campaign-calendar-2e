import { useState } from 'react'
import { dateLabel, displayYear } from './calendar'
import { closingDay, dueMonth, formatGp, holdingDefaults, monthAt, previewTurn, recordTurn, reopenTurn, replayInputs, resourceRates, sameMonth,
  type Holding, type LedgerLine, type Receipt, type TurnInputs, type TurnMonth } from './domain'
import type { Campaign } from './storage'

export type ReceiptLink = { holdingId: string; month: TurnMonth }
type Props = {
  campaign: Campaign
  revision: string | null
  receipt?: ReceiptLink
  save: (holdings: Holding[]) => Promise<boolean>
  backup: () => void
}
type Screen =
  | { type: 'holding'; draft: Holding; revision: Props['revision'] }
  | { type: 'preview'; id: string; month: TurnMonth; draft: TurnInputs; revision: Props['revision'] }
  | { type: 'receipt'; link: ReceiptLink }
  | { type: 'reopen'; link: ReceiptLink; revision: Props['revision'] }

function Money({ label, value, change, signed = false, optional = false }: {
  label: string; value?: number; change: (value?: number) => void; signed?: boolean; optional?: boolean
}) {
  return <label>{label}<input type="number" step=".01" min={signed ? undefined : 0} required={!optional}
    value={value === undefined ? '' : value / 100} onChange={event => change(event.target.value === '' ? undefined : Math.round(event.target.valueAsNumber * 100))}/></label>
}

function Rates({ values, change }: { values: Pick<TurnInputs, 'families' | 'tax' | 'services' | 'resources'>; change: (values: Pick<TurnInputs, 'families' | 'tax' | 'services' | 'resources'>) => void }) {
  return <>
    <div className="domain-fields">
      <label>Families<input type="number" min="0" step="1" required value={values.families} onChange={e => change({ ...values, families: +e.target.value })}/></label>
      <Money label="Tax per family (gp)" value={values.tax} change={tax => change({ ...values, tax: tax ?? 0 })}/>
      <Money label="Services per family (gp equivalent)" value={values.services} change={services => change({ ...values, services: services ?? 0 })}/>
    </div>
    <fieldset><legend>Resources</legend>
      {values.resources.map((resource, index) => {
        const update = (patch: Partial<typeof resource>) => change({ ...values, resources: values.resources.map((item, i) => i === index ? { ...item, ...patch } : item) })
        return <div className="domain-fields domain-line" key={index}>
          <label>Name<input value={resource.name} required maxLength={120} onChange={e => update({ name: e.target.value })}/></label>
          <label>Type<select value={resource.type} onChange={e => update({ type: e.target.value as typeof resource.type })}>
            {Object.keys(resourceRates).map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Rate override (gp per family)<input type="number" min="0" step=".01" value={resource.rate === undefined ? '' : resource.rate / 100}
            placeholder={String(resourceRates[resource.type] / 100)}
            onChange={e => update({ rate: e.target.value === '' ? undefined : Math.round(e.target.valueAsNumber * 100) })}/></label>
          <button type="button" onClick={() => change({ ...values, resources: values.resources.filter((_, i) => i !== index) })}>Remove resource</button>
        </div>
      })}
      <button type="button" onClick={() => change({ ...values, resources: [...values.resources, { name: '', type: 'animal' }] })}>Add resource</button>
    </fieldset>
  </>
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

export function DomainPanel({ campaign, revision, receipt, save, backup }: Props) {
  const [screen, setScreen] = useState<Screen | undefined>(receipt ? { type: 'receipt', link: receipt } : undefined)
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
    opening: { cash: 0, noncash: 0 }, families: 0, tax: 100, services: 1000, resources: [], turns: [], replay: [],
  } })
  const back = <button type="button" onClick={() => go()}>Back to holdings</button>

  if (screen?.type === 'holding') {
    const { draft } = screen
    const change = (patch: Partial<Holding>) => setScreen({ ...screen, draft: { ...draft, ...patch } })
    const year = displayYear(calendar, draft.first.year)
    const openingEditable = draft.turns.length === 0
    return <form className="form" onSubmit={e => {
      e.preventDefault()
      if (stale || pending) return
      void persist(draft)
    }}>
      <h3>{holdings.some(item => item.id === draft.id) ? 'Edit holding' : 'New holding'}</h3>
      {stale && <p role="alert" className="warning">Campaign data changed. Return to holdings and reopen the editor.</p>}
      <div className="domain-fields">
        <label>Holding name<input required maxLength={120} value={draft.name} onChange={e => change({ name: e.target.value })}/></label>
        <label>Ruler<input required maxLength={120} value={draft.ruler} onChange={e => change({ ruler: e.target.value })}/></label>
        <label>Liege<input maxLength={120} value={draft.liege} onChange={e => change({ liege: e.target.value })}/></label>
      </div>
      <Rates values={draft} change={change}/>
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
        </div></fieldset>
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
    const change = (patch: Partial<TurnInputs>) => setScreen({ ...screen, draft: { ...draft, ...patch } })
    let result: Receipt | undefined
    let invalid = ''
    if (!stale) {
      try { result = previewTurn(holding, month, draft) }
      catch (cause) { invalid = cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'Complete all required ledger fields with valid amounts.' }
    }
    const addLine = (name: string, balance: LedgerLine['balance']) =>
      change({ adjustments: [...draft.adjustments, { name, balance, amount: 0 }] })
    return <form className="form" onSubmit={e => {
      e.preventDefault()
      if (!result || stale || pending) return
      try {
        const updated = recordTurn(calendar, current, holding, month, draft)
        void persist(updated, { type: 'receipt', link: { holdingId: holding.id, month } })
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record the turn.') }
    }}>
      <h3>{holding.name} · {date(month)}</h3>
      {stale ? <div className="warning" role="alert">This preview is stale. Refresh to use the latest ledger and campaign date.</div> : <>
        <button type="button" onClick={() => setScreen({ ...screen, draft: holdingDefaults(holding) })}>Reset to current defaults</button>
        <Rates values={draft} change={change}/>
        <div className="form-row">
          <Money label="Total resource value override (gp)" optional value={draft.override} change={override => change({ override })}/>
          <Money label="Resource value realized in cash (gp)" value={draft.realized} change={realized => change({ realized: realized ?? 0 })}/>
        </div>
        <fieldset><legend>Expenses and adjustments</legend>
          {draft.adjustments.map((line, index) => {
            const update = (patch: Partial<LedgerLine>) => change({ adjustments: draft.adjustments.map((item, i) => i === index ? { ...item, ...patch } : item) })
            return <div className="domain-fields domain-line" key={index}>
              <label>Entry<input required maxLength={120} value={line.name} onChange={e => update({ name: e.target.value })}/></label>
              <label>Balance<select value={line.balance} onChange={e => update({ balance: e.target.value as LedgerLine['balance'] })}><option value="cash">Cash</option><option value="noncash">Noncash</option></select></label>
              <Money label="Amount (gp, negative for debits)" signed value={line.amount} change={amount => update({ amount: amount ?? 0 })}/>
              <button type="button" onClick={() => change({ adjustments: draft.adjustments.filter((_, i) => i !== index) })}>Remove entry</button>
            </div>
          })}
          <div className="button-group"><button type="button" onClick={() => addLine('', 'cash')}>Add ledger entry</button><button type="button" onClick={() => addLine('Noncash expiration', 'noncash')}>Add expiration</button></div>
        </fieldset>
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
      <Ledger turn={turn}/>
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
      return <section className="domain-holding" key={holding.id}>
        <h3>{holding.name}</h3>
        <p>{formatGp(balance.cash)} cash · {formatGp(balance.noncash)} noncash</p>
        <p>Next turn closes {date(next)}.</p>
        <div className="button-group">
          <button onClick={() => startHolding(holding)}>Edit holding</button>
          <button disabled={closingDay(calendar, next) > current} onClick={() => startPreview(holding)}>Preview turn</button>
        </div>
        {holding.turns.length > 0 && <details><summary>Turn history</summary>
          <ul>{[...holding.turns].reverse().map(turn => <li key={date(turn.month)}><button onClick={() => go({ type: 'receipt', link: { holdingId: holding.id, month: turn.month } })}>{date(turn.month)}</button></li>)}</ul>
        </details>}
      </section>
    })}
  </div>
}
