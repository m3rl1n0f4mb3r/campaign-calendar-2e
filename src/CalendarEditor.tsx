import { useState } from 'react'
import { phaseNames, type Calendar } from './calendar'
import { migrate } from './migration'
import { DateField } from './DateField'
import { MigrationCalendar } from './MigrationCalendar'
import type { Campaign } from './storage'

export function CalendarEditor({ campaign, save, backup, close }: { campaign: Campaign; save: (campaign: Campaign) => void; backup: () => void; close: () => void }) {
  const [draft, setDraft] = useState<Calendar>(campaign.calendar)
  const [weekdays, setWeekdays] = useState(draft.weekdays.join(', '))
  const [preview, setPreview] = useState<ReturnType<typeof migrate>>()
  const [error, setError] = useState('')
  const updatePeriod = (index: number, patch: Partial<Calendar['periods'][number]>) => setDraft({ ...draft, periods: draft.periods.map((period, i) => i === index ? { ...period, ...patch } : period) })
  const updateMoon = (index: number, patch: Partial<Calendar['moons'][number]>) => setDraft({ ...draft, moons: draft.moons.map((moon, i) => i === index ? { ...moon, ...patch } : moon) })
  if (preview) return <div className="form">
    <p className="warning"><strong>Calendar migration.</strong> Changing the calendar can shift weekdays, recurring dates, and moon phases.</p>
    {preview.errors.length > 0 && <ul className="error">{preview.errors.map((line, i) => <li key={i}>{line}</li>)}</ul>}
    <MigrationCalendar original={campaign} preview={preview}/>
    {preview.changes.length > 0 && <details><summary>Change details</summary><ul className="migration-list">{preview.changes.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
    <div className="actions"><button onClick={() => setPreview(undefined)}>Back</button><button onClick={backup}>Download backup</button><button className="primary" disabled={preview.errors.length > 0} onClick={() => save(preview.campaign)}>Apply migration</button></div>
  </div>
  return <form className="form" onSubmit={event => {
    event.preventDefault()
    const names = weekdays.split(',').map(name => name.trim()).filter(Boolean)
    if (!names.length || names.length > 30 || !draft.periods.some(p => !p.festival) || draft.periods.some(p => !p.name.trim()) || draft.moons.some(m => !m.name.trim())) {
      setError('Enter period and moon names, at least one month, and 1 to 30 weekdays.'); return
    }
    const next = { ...draft, weekdays: names }
    const previous = campaign.calendar
    const structural = names.length !== previous.weekdays.length || draft.periods.length !== previous.periods.length || draft.periods.some((period, index) =>
      period.id !== previous.periods[index]?.id || period.days !== previous.periods[index]?.days || period.festival !== previous.periods[index]?.festival)
    if (!structural) save({ ...campaign, calendar: next })
    else setPreview(migrate(campaign, next))
  }}>
    <label>Weekdays, separated by commas<input required value={weekdays} onChange={e => setWeekdays(e.target.value)}/></label>
    <div className="form-row"><label>Before-era label<input value={draft.before} onChange={e => setDraft({ ...draft, before: e.target.value })}/></label><label>After-era label<input value={draft.after} onChange={e => setDraft({ ...draft, after: e.target.value })}/></label></div>
    <label className="check"><input type="checkbox" checked={draft.skipZero} onChange={e => setDraft({ ...draft, skipZero: e.target.checked })}/>Skip year zero</label>
    <fieldset><legend>Calendar periods</legend>
      {draft.periods.map((period, i) => <div className="period-row" key={period.id}>
        <input aria-label="Period name" value={period.name} maxLength={120} required onChange={e => updatePeriod(i, { name: e.target.value })}/>
        <input aria-label={`${period.name} length`} type="number" min="1" max="366" required value={period.days || ''} onChange={e => updatePeriod(i, { days: +e.target.value })}/>
        <select aria-label="Period type" value={String(period.festival)} onChange={e => updatePeriod(i, { festival: e.target.value === 'true' })}><option value="false">Month</option><option value="true">Festival</option></select>
        <button type="button" aria-label={`Move ${period.name} earlier`} disabled={i === 0} onClick={() => {
          const periods = [...draft.periods]
          ;[periods[i - 1], periods[i]] = [periods[i], periods[i - 1]]
          setDraft({ ...draft, periods })
        }}>↑</button>
        <button type="button" aria-label={`Remove ${period.name}`} disabled={draft.periods.length === 1} onClick={() => setDraft({ ...draft, periods: draft.periods.filter(p => p.id !== period.id) })}>×</button>
      </div>)}
      <button type="button" disabled={draft.periods.length >= 60} onClick={() => setDraft({ ...draft, periods: [...draft.periods, { id: crypto.randomUUID(), name: 'New period', days: 7, festival: true }] })}>Add period</button>
    </fieldset>
    <fieldset><legend>Moons</legend>
      {draft.moons.map((moon, i) => <div className="moon-settings" key={i}>
        <div className="form-row"><label>Name<input required maxLength={120} value={moon.name} onChange={e => updateMoon(i, { name: e.target.value })}/></label><label>Cycle in days<input type="number" min="0.001" max="100000" step="any" required value={moon.cycle || ''} onChange={e => updateMoon(i, { cycle: +e.target.value, source: 'GM-supplied configuration' })}/></label></div>
        <DateField calendar={campaign.calendar} label="Anchor date" value={moon.anchor} onChange={anchor => updateMoon(i, { anchor, source: 'GM-supplied anchor' })}/>
        <label>Phase on anchor date<select value={moon.phase} onChange={e => updateMoon(i, { phase: +e.target.value, source: 'GM-supplied anchor' })}>{phaseNames.map((name, phase) => <option key={phase} value={phase}>{name}</option>)}</select></label>
        <p className="muted">{moon.source}</p>
        <button type="button" onClick={() => setDraft({ ...draft, moons: draft.moons.filter((_, index) => index !== i) })}>Remove moon</button>
      </div>)}
      <button type="button" disabled={draft.moons.length >= 30} onClick={() => setDraft({ ...draft, moons: [...draft.moons, { name: 'New moon', cycle: 28, anchor: campaign.current, phase: 4, source: 'GM-supplied anchor' }] })}>Add moon</button>
    </fieldset>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="actions"><button type="button" onClick={close}>Cancel</button><button className="primary">Review calendar</button></div>
  </form>
}
