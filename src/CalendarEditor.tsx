import { useState } from 'react'
import { dateParts, moonColor, moonPhase, phaseNames, yearLabel, type Calendar } from './calendar'
import { useChangedDraft, useDialogLeave } from './Dialog'
import { migrate } from './migration'
import { DateField } from './DateField'
import { MigrationCalendar } from './MigrationCalendar'
import type { Campaign } from './storage'

export function structuralCalendarChange(previous: Calendar, next: Calendar) {
  return next.weekdays.length !== previous.weekdays.length || next.periods.length !== previous.periods.length ||
    next.periods.some((period, index) => period.id !== previous.periods[index]?.id ||
      period.days !== previous.periods[index]?.days || period.festival !== previous.periods[index]?.festival)
}

function settingsChanges(previous: Campaign, next: Campaign) {
  const changes: string[] = []
  const add = (label: string, before: string, after: string) => {
    if (before !== after) changes.push(`${label} · ${before || '(blank)'} → ${after || '(blank)'}`)
  }
  const before = previous.calendar
  const after = next.calendar
  add('Campaign name', previous.name, next.name)
  add('Weekdays', before.weekdays.join(', '), after.weekdays.join(', '))
  add('Before-era label', before.before, after.before)
  add('After-era label', before.after, after.after)
  add('Year zero', before.skipZero ? 'Skipped' : 'Included', after.skipZero ? 'Skipped' : 'Included')
  add('Displayed campaign year', yearLabel(before, dateParts(before, previous.current).year), yearLabel(after, dateParts(after, next.current).year))
  add('Moons on calendar', (before.showMoons ?? true) ? 'Shown' : 'Hidden', (after.showMoons ?? true) ? 'Shown' : 'Hidden')
  if (before.periods.map(period => period.id).join() !== after.periods.map(period => period.id).join()) {
    add('Period order', before.periods.map(period => period.name).join(', '), after.periods.map(period => period.name).join(', '))
  }
  for (const period of before.periods) {
    if (!after.periods.some(item => item.id === period.id)) changes.push(`Remove period · ${period.name}`)
  }
  for (const period of after.periods) {
    const old = before.periods.find(item => item.id === period.id)
    if (!old) changes.push(`Add period · ${period.name} (${period.days} days, ${period.festival ? 'festival' : 'month'})`)
    else {
      add('Period name', old.name, period.name)
      add(`${period.name} length`, `${old.days} days`, `${period.days} days`)
      add(`${period.name} type`, old.festival ? 'Festival' : 'Month', period.festival ? 'Festival' : 'Month')
    }
  }
  const moonSettings = (data: Campaign) => data.calendar.moons.map((moon, index) =>
    `${moon.name} (${moon.cycle}-day cycle, ${phaseNames[moonPhase(moon, data.current)]} on campaign date, anchor ${moon.anchor}, ${phaseNames[moon.phase]} at anchor, ${moonColor(moon, index)})`).join(', ')
  add('Moon settings and current phases', moonSettings(previous), moonSettings(next))
  return changes
}

export function CalendarEditor({ campaign, save, backup, close }: { campaign: Campaign; save: (campaign: Campaign) => void; backup: () => void; close: () => void }) {
  const [original] = useState(campaign)
  const [name, setName] = useState(campaign.name)
  const [draft, setDraft] = useState<Calendar>(campaign.calendar)
  const [weekdays, setWeekdays] = useState(draft.weekdays.join(', '))
  const [preview, setPreview] = useState<{ next: Campaign; migration?: ReturnType<typeof migrate> }>()
  const [error, setError] = useState('')
  const leave = useDialogLeave()
  const names = weekdays.split(',').map(name => name.trim()).filter(Boolean)
  const changed = name.trim() !== original.name || JSON.stringify({ ...draft, weekdays: names }) !== JSON.stringify(original.calendar)
  const valid = !!name.trim() && names.length > 0 && names.length <= 30 && names.every(label => label.length <= 120) &&
    draft.periods.some(p => !p.festival) && draft.periods.every(p => !!p.name.trim() && Number.isInteger(p.days) && p.days >= 1 && p.days <= 366) &&
    draft.moons.every(m => !!m.name.trim() && m.cycle >= 0.001 && m.cycle <= 100_000)
  const stale = campaign !== original
  useChangedDraft([name, draft, weekdays])
  const updatePeriod = (index: number, patch: Partial<Calendar['periods'][number]>) => setDraft({ ...draft, periods: draft.periods.map((period, i) => i === index ? { ...period, ...patch } : period) })
  const updateMoon = (index: number, patch: Partial<Calendar['moons'][number]>) => setDraft({ ...draft, moons: draft.moons.map((moon, i) => i === index ? { ...moon, ...patch } : moon) })
  if (preview) {
    const { migration, next } = preview
    const changes = settingsChanges(original, next)
    return <div className="form">
      {stale && <p className="warning" role="alert">Campaign data changed. Reopen Calendar settings before saving.</p>}
      {migration ? <p className="warning"><strong>Calendar migration.</strong> Changing the calendar can shift weekdays, recurring dates, and moon phases.</p>
        : <p><strong>Existing dates stay in place.</strong></p>}
      {changes.length > 0 && <ul className="migration-list">{changes.map((line, i) => <li key={i}>{line}</li>)}</ul>}
      {migration && <>
        {migration.errors.length > 0 && <ul className="error">{migration.errors.map((line, i) => <li key={i}>{line}</li>)}</ul>}
        <MigrationCalendar original={original} preview={migration}/>
        {migration.changes.length > 0 && <details><summary>Migration details</summary><ul className="migration-list">{migration.changes.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
      </>}
      <div className="actions"><button onClick={() => setPreview(undefined)}>Back</button>{migration && <button onClick={backup}>Download backup</button>}
        <button className="primary" disabled={stale || !!migration?.errors.length} onClick={() => save(next)}>{migration ? 'Apply migration' : 'Save changes'}</button></div>
    </div>
  }
  return <form className="form" onSubmit={event => {
    event.preventDefault()
    if (!changed || stale) return
    if (!valid) { setError('Enter valid campaign, period, and moon names and 1 to 30 weekdays.'); return }
    const next = { ...draft, weekdays: names }
    const migration = structuralCalendarChange(original.calendar, next) ? migrate(original, next) : undefined
    setPreview({ next: { ...(migration?.campaign ?? { ...original, calendar: next }), name: name.trim() }, migration })
  }}>
    {stale && <p className="warning" role="alert">Campaign data changed. Reopen Calendar settings before saving.</p>}
    <label>Campaign name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label>
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
      {draft.moons.length > 0 && <label className="check"><input type="checkbox" checked={draft.showMoons ?? true}
        onChange={event => setDraft({ ...draft, showMoons: event.target.checked })}/> Show moons on the calendar</label>}
      {draft.moons.map((moon, i) => <div className="moon-settings" key={i}>
        <div className="form-row"><label>Name<input required maxLength={120} value={moon.name} onChange={e => updateMoon(i, { name: e.target.value })}/></label><label>Cycle in days<input type="number" min="0.001" max="100000" step="any" required value={moon.cycle || ''} onChange={e => updateMoon(i, { cycle: +e.target.value, source: 'GM-supplied configuration' })}/></label></div>
        <DateField calendar={campaign.calendar} label="Anchor date" value={moon.anchor} onChange={anchor => updateMoon(i, { anchor, source: 'GM-supplied anchor' })}/>
        <label>Phase on anchor date<select value={moon.phase} onChange={e => updateMoon(i, { phase: +e.target.value, source: 'GM-supplied anchor' })}>{phaseNames.map((name, phase) => <option key={phase} value={phase}>{name}</option>)}</select></label>
        <label>Calendar color<input type="color" aria-label={`Calendar color for ${moon.name}`} value={moonColor(moon, i)} onChange={e => updateMoon(i, { color: e.target.value })}/></label>
        <p className="muted">{moon.source}</p>
        <button type="button" onClick={() => setDraft({ ...draft, moons: draft.moons.filter((_, index) => index !== i) })}>Remove moon</button>
      </div>)}
      <button type="button" disabled={draft.moons.length >= 30} onClick={() => setDraft({ ...draft, moons: [...draft.moons, { name: 'New moon', cycle: 28, anchor: campaign.current, phase: 4, source: 'GM-supplied anchor' }] })}>Add moon</button>
    </fieldset>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="actions"><button type="button" onClick={() => leave(close)}>Cancel</button><button className="primary" disabled={!changed || !valid || stale}>Review calendar</button></div>
  </form>
}
