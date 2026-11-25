import { dateIndex, dateParts, yearLabel, type Calendar } from './calendar'

export const printKinds = {
  'all-day': 'All-day events',
  timed: 'Timed events',
  turn: 'Domain turns',
  dominion: 'Dominion events',
  construction: 'Construction milestones',
}
export type PrintKind = keyof typeof printKinds
export type PrintEntry = { key: string; title: string; start: number; end: number; kind: PrintKind; time?: string; location?: string }
export type PrintSection = { from: number; to: number; title: string; grid: boolean }

export function printPeriods(calendar: Calendar, from: number, through: number): PrintSection[] {
  const start = dateIndex(calendar, { ...dateParts(calendar, from), day: 1 })
  const last = dateIndex(calendar, { ...dateParts(calendar, through), day: 1 })
  if (last < start) throw new Error('Choose an end period on or after the start period.')
  const sections: PrintSection[] = []
  for (let day = start; day <= last;) {
    if (sections.length >= 120) throw new Error('Choose up to 120 periods per print job.')
    const date = dateParts(calendar, day)
    const period = calendar.periods.find(item => item.id === date.period)!
    sections.push({ from: day, to: day + period.days, title: `${period.name} · ${yearLabel(calendar, date.year)}`, grid: true })
    day += period.days
  }
  return sections
}

export function filterPrintEntries(entries: PrintEntry[], kinds: ReadonlySet<PrintKind>) {
  return entries.filter(entry => kinds.has(entry.kind))
}
