// Business time is Asia/Kolkata no matter where the browser is.
export const IST = 'Asia/Kolkata'

export type IstNow = { date: string; time: string }

export function istNow(now: Date = new Date()): IstNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` }
}

export const istToday = (now?: Date) => istNow(now).date

/** Calendar arithmetic on YYYY-MM-DD strings (no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function dayLabel(date: string, today: string = istToday()): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function formatTime12(value: string): string {
  const [hours = '0', minutes = '00'] = value.split(':')
  const hour = Number(hours)
  return `${hour % 12 || 12}:${minutes.padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

export type SlotLike = { slotDate: string; startTime: string; capacity: number; bookedCount: number; status: string }

/** Mirrors the checks place_order() makes server-side (the server stays authoritative). */
export function isSlotBookable(slot: SlotLike, now: IstNow = istNow(), maxDaysAhead = 7): boolean {
  if (!['AVAILABLE', 'LIMITED'].includes(slot.status) || slot.bookedCount >= slot.capacity) return false
  if (slot.slotDate > addDays(now.date, maxDaysAhead)) return false
  if (slot.slotDate > now.date) return true
  return slot.slotDate === now.date && slot.startTime > now.time
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))
}
