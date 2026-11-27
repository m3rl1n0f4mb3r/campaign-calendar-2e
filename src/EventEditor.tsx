import { useState } from 'react'
import { dateParts, mod, type Calendar } from './calendar'
import { dayOf, minutes, type EventData, type Occurrence, type Rule } from './events'
import { useChangedDraft, useDialogLeave } from './Dialog'
import { DateField } from './DateField'

export type Scope = 'one' | 'future' | 'all'
const clock = (value: number) => `${String(Math.floor(mod(value, minutes) / 60)).padStart(2, '0')}:${String(mod(value, 60)).padStart(2, '0')}`
const timeOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))

export function EventEditor({ calendar, day, event, save, close, help }: {
  calendar: Calendar; day: number; event?: Occurrence; save: (scope: Scope, data?: EventData, rule?: Rule) => void; close: () => void; help: () => void
}) {
  const [scope, setScope] = useState<Scope>(event?.series.rule ? 'one' : 'all')
  const [data, setData] = useState<EventData>(event ?? { title: '', notes: '', location: '', color: '#52745e', start: day * minutes, end: (day + 1) * minutes, allDay: true })
  const [rule, setRule] = useState<Rule | undefined>(event?.series.rule)
  const leave = useDialogLeave()
  useChangedDraft([data, rule], [event ? scope === 'all' ? event.series : event : { title: '', notes: '', location: '', color: '#52745e', start: day * minutes, end: (day + 1) * minutes, allDay: true }, event?.series.rule])
  const [error, setError] = useState('')
  const startDay = dayOf(data.start)
  const endDay = dayOf(data.end - (data.allDay ? minutes : 0))
  const isFestival = calendar.periods.find(period => period.id === dateParts(calendar, startDay).period)?.festival
  const seriesEdit = scope !== 'one'
  return <form className="form" onSubmit={submit => {
    submit.preventDefault()
    if (!data.title.trim() || data.start >= data.end) { setError('Enter a title and an end after the start.'); return }
    if (seriesEdit && rule?.until !== undefined && rule.until < startDay) { setError('The repeat end date must be on or after the event start.'); return }
    save(scope, { ...data, title: data.title.trim() }, seriesEdit ? rule : undefined)
  }}>
    <button type="button" onClick={help}>Help with events</button>
    {event?.series.rule && <label>Apply changes to<select value={scope} onChange={change => {
      const value = change.target.value as Scope
      setScope(value)
      setData(value === 'all' ? event.series : event)
      setRule(event.series.rule)
    }}><option value="one">This occurrence</option><option value="future">This and following</option><option value="all">Entire series</option></select></label>}
    <label>Title<input autoFocus required maxLength={120} value={data.title} onChange={e => setData({ ...data, title: e.target.value })}/></label>
    <div className="form-row"><label>Location<input value={data.location} onChange={e => setData({ ...data, location: e.target.value })}/></label>
    <label>Color<input type="color" value={data.color} onChange={e => setData({ ...data, color: e.target.value })}/></label></div>
    <label>Notes<textarea rows={3} value={data.notes} onChange={e => setData({ ...data, notes: e.target.value })}/></label>
    <label className="check"><input type="checkbox" checked={data.allDay} onChange={e => {
      const allDay = e.target.checked
      setData({ ...data, allDay, start: startDay * minutes + (allDay ? 0 : 540), end: (allDay ? Math.max(startDay, dayOf(data.end - 1)) + 1 : endDay) * minutes + (allDay ? 0 : 600) })
    }}/>All day</label>
    <div className="form-row">
      <DateField calendar={calendar} value={startDay} label="Start date" onChange={value => {
        const start = value * minutes + mod(data.start, minutes)
        setData({ ...data, start, end: data.end + start - data.start })
      }}/>
      <DateField calendar={calendar} value={endDay} label={data.allDay ? 'Last day (included)' : 'End date'} onChange={value => setData({ ...data, end: (value + Number(data.allDay)) * minutes + mod(data.end, minutes) })}/>
    </div>
    {!data.allDay && <div className="form-row">
      <label>Start time<input type="time" required value={clock(data.start)} onChange={e => { if (e.target.value) setData({ ...data, start: startDay * minutes + timeOf(e.target.value) }) }}/></label>
      <label>End time<input type="time" required value={clock(data.end)} onChange={e => { if (e.target.value) setData({ ...data, end: endDay * minutes + timeOf(e.target.value) }) }}/></label>
    </div>}
    {seriesEdit && <label>Repeat<select value={rule?.frequency ?? ''} onChange={e => setRule(e.target.value ? { ...(rule ?? { interval: 1, weekdays: [], festival: 'previous' }), frequency: e.target.value as Rule['frequency'] } : undefined)}>
      <option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
    </select></label>}
    {seriesEdit && rule && <>
      <div className="form-row"><label>Repeat interval<input type="number" min="1" max="10000" required value={rule.interval || ''} onChange={e => setRule({ ...rule, interval: +e.target.value })}/></label>
      <label>Ends<select value={rule.count !== undefined ? 'count' : rule.until !== undefined ? 'date' : 'never'} onChange={e => setRule({ ...rule, count: e.target.value === 'count' ? 10 : undefined, until: e.target.value === 'date' ? startDay + 30 : undefined })}><option value="never">Never</option><option value="count">After a number of occurrences</option><option value="date">On a date</option></select></label></div>
      {rule.count !== undefined && <label>Occurrences<input type="number" required min="1" max="10000" value={rule.count || ''} onChange={e => setRule({ ...rule, count: +e.target.value })}/></label>}
      {rule.until !== undefined && <DateField calendar={calendar} label="Repeat through" value={rule.until} onChange={until => setRule({ ...rule, until })}/>}
      {rule.frequency === 'weekly' && <fieldset><legend>Repeat on</legend><div className="weekday-options">{calendar.weekdays.map((name, index) => <label className="check" key={index}><input type="checkbox" checked={rule.weekdays.includes(index)} onChange={e => setRule({ ...rule, weekdays: e.target.checked ? [...rule.weekdays, index] : rule.weekdays.filter(day => day !== index) })}/>{name}</label>)}</div></fieldset>}
      {isFestival && ['monthly', 'yearly'].includes(rule.frequency) && <label>Festival repeats<select value={rule.festival} onChange={e => setRule({ ...rule, festival: e.target.value as Rule['festival'] })}><option value="previous">Last day of previous month</option><option value="next">First day of next month</option><option value="festival">Same festival day each year</option></select></label>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="actions">{event && <button type="button" className="danger" onClick={() => save(scope)}>Delete</button>}<button type="button" onClick={() => leave(close)}>Cancel</button><button className="primary">Save event</button></div>
  </form>
}
