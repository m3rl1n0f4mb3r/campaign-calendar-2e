import { dateIndex, dateParts, displayYear, type Calendar } from './calendar'

export function DateField({ calendar, value, onChange, label }: { calendar: Calendar; value: number; onChange: (value: number) => void; label: string }) {
  const date = dateParts(calendar, value)
  const period = calendar.periods.find(item => item.id === date.period)!
  return <fieldset className="date-field"><legend>{label}</legend><div>
    <select aria-label={`${label} period`} value={date.period} onChange={event => {
      const next = calendar.periods.find(item => item.id === event.target.value)!
      onChange(dateIndex(calendar, { ...date, period: next.id, day: Math.min(date.day, next.days) }))
    }}>{calendar.periods.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <select aria-label={`${label} day`} value={date.day} onChange={event => onChange(dateIndex(calendar, { ...date, day: +event.target.value }))}>
      {Array.from({ length: period.days }, (_, index) => <option key={index}>{index + 1}</option>)}
    </select>
    <input aria-label={`${label} year`} type="number" max="99999" min="-99999" required key={date.year} defaultValue={displayYear(calendar, date.year)} onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
      }
    }} onBlur={event => {
      const displayed = event.target.valueAsNumber
      if (!Number.isInteger(displayed) || Math.abs(displayed) > 99999 || (displayed === 0 && calendar.skipZero)) {
        event.target.value = String(displayYear(calendar, date.year))
        return
      }
      onChange(dateIndex(calendar, { ...date, year: displayed - Number(calendar.skipZero && displayed > 0) }))
    }}/>
  </div></fieldset>
}
