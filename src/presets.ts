import { dateIndex, template, type Calendar } from './calendar'

export const lanceSource = 'https://tuscriaturasarchivos.home.blog/wp-content/uploads/2018/12/Tales-of-the-Lance.pdf'
export function dragonlance() {
  const calendar: Calendar = {
    ...template(),
    before: 'PC', after: 'AC',
    periods: ['Aelmont', 'Rannmont', 'Mishamont', 'Chislmont', 'Bran', 'Corij', 'Argon', 'Sirmont', 'Reorxmont', 'Hiddumont', 'H’armont', 'Phoenix']
      .map((name, i) => ({ id: `month-${i + 1}`, name, days: 28, festival: false })),
    weekdays: ['Gileadai', 'Luindai', 'Nuindai', 'Soldai', 'Manthus', 'Shinarai', 'Boreadai'],
  }
  const current = dateIndex(calendar, { year: -1, period: 'month-1', day: 1 })
  calendar.moons = [{ name: 'Solinari', cycle: 36 }, { name: 'Lunitari', cycle: 28 }, { name: 'Nuitari', cycle: 8 }]
    .map(moon => ({ ...moon, anchor: current, phase: 4, source: 'Sample full-moon anchor. Cycle length from Tales of the Lance.' }))
  return { calendar, current }
}

export function greyhawk(): Calendar {
  return {
    ...template(), after: 'CY',
    weekdays: ['Starday', 'Sunday', 'Moonday', 'Godsday', 'Waterday', 'Earthday', 'Freeday'],
    periods: ['Needfest', 'Fireseek', 'Readying', 'Coldeven', 'Growfest', 'Planting', 'Flocktime', 'Wealsun', 'Richfest', 'Reaping', 'Goodmonth', 'Harvester', 'Brewfest', 'Patchwall', 'Ready’reat', 'Sunsebb']
      .map((name, i) => ({ id: `period-${i + 1}`, name, days: i % 4 === 0 ? 7 : 28, festival: i % 4 === 0 })),
  }
}
