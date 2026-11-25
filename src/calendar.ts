export type Period = { id: string; name: string; days: number; festival: boolean }
export type Moon = { name: string; cycle: number; anchor: number; phase: number; source: string; color?: string }
export type Calendar = { periods: Period[]; weekdays: string[]; before: string; after: string; skipZero: boolean; moons: Moon[]; showMoons?: boolean }
export type DateParts = { year: number; period: string; day: number }

export const mod = (n: number, d: number) => ((n % d) + d) % d
export const yearLength = (cal: Calendar) => cal.periods.reduce((sum, period) => sum + period.days, 0)
export const weekday = (cal: Calendar, day: number) => mod(day, cal.weekdays.length)

export function dateParts(cal: Calendar, index: number): DateParts {
  const length = yearLength(cal)
  const year = Math.floor(index / length)
  let offset = mod(index, length)
  for (const period of cal.periods) {
    if (offset < period.days) return { year, period: period.id, day: offset + 1 }
    offset -= period.days
  }
  throw new Error('Invalid calendar')
}

export function dateIndex(cal: Calendar, date: DateParts) {
  let offset = date.year * yearLength(cal)
  for (const period of cal.periods) {
    if (period.id === date.period) {
      if (date.day < 1 || date.day > period.days || !Number.isSafeInteger(offset + date.day - 1)) break
      return offset + date.day - 1
    }
    offset += period.days
  }
  throw new Error('Date is outside the calendar')
}

export const displayYear = (cal: Calendar, year: number) => year + Number(cal.skipZero && year >= 0)
export function yearLabel(cal: Calendar, year: number) {
  const value = displayYear(cal, year)
  const era = value < 0 ? cal.before : cal.after
  return era ? `${Math.abs(value)} ${era}` : String(value)
}

export function dateLabel(cal: Calendar, index: number) {
  const date = dateParts(cal, index)
  return `${date.day} ${cal.periods.find(p => p.id === date.period)?.name}, ${yearLabel(cal, date.year)}`
}

export function movePeriod(cal: Calendar, index: number, amount: number, monthsOnly = false) {
  const date = dateParts(cal, index)
  const periods = monthsOnly ? cal.periods.filter(p => !p.festival) : cal.periods
  const position = periods.findIndex(p => p.id === date.period) + amount
  const period = periods[mod(position, periods.length)]
  return dateIndex(cal, { year: date.year + Math.floor(position / periods.length), period: period.id, day: Math.min(date.day, period.days) })
}

export const phaseNames = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent']
const moonColors = ['#697681', '#a13442', '#634783', '#315d9b', '#27705d', '#8d591b']
export const moonColor = (moon: Moon, index: number) => moon.color ?? moonColors[index % moonColors.length]
export const phaseSymbols = ['●', '◔', '◑', '◕', '○', '◕', '◐', '◔']
export const moonPhase = (moon: Moon, day: number) => mod(Math.round((day - moon.anchor) * 8 / moon.cycle + moon.phase), 8)

export function template(): Calendar {
  return {
    periods: Array.from({ length: 12 }, (_, i) => ({ id: `month-${i + 1}`, name: `Month ${i + 1}`, days: 30, festival: false })),
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    before: '', after: '', skipZero: true, moons: [],
  }
}
