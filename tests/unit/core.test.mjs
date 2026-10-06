import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, dayLabel, formatTime12, isSlotBookable, istNow } from '../../src/lib/time.ts'
import { orderTotals, lineTotal, unitPrice, formatMoney } from '../../src/lib/pricing.ts'
import { friendlyError, parsePaymentInProgress } from '../../src/lib/errors.ts'

test('istNow: converts UTC instants to Asia/Kolkata (incl. date rollover)', () => {
  assert.deepEqual(istNow(new Date('2026-10-05T18:29:59Z')), { date: '2026-10-05', time: '23:59:59' })
  assert.deepEqual(istNow(new Date('2026-10-05T18:30:00Z')), { date: '2026-10-06', time: '00:00:00' })
  assert.deepEqual(istNow(new Date('2026-12-31T20:00:00Z')), { date: '2027-01-01', time: '01:30:00' })
})
test('addDays / dayLabel', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02'); assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(dayLabel('2026-10-06', '2026-10-06'), 'Today'); assert.equal(dayLabel('2026-10-07', '2026-10-06'), 'Tomorrow')
})
test('formatTime12', () => { assert.equal(formatTime12('00:05:00'), '12:05 AM'); assert.equal(formatTime12('13:40:00'), '1:40 PM'); assert.equal(formatTime12('12:00'), '12:00 PM') })
test('slot bookability uses IST, capacity, status and the 7-day window', () => {
  const now = { date: '2026-10-06', time: '12:00:00' }
  const slot = (o) => ({ slotDate: '2026-10-06', startTime: '13:00:00', capacity: 3, bookedCount: 0, status: 'AVAILABLE', ...o })
  assert.equal(isSlotBookable(slot({}), now), true)
  assert.equal(isSlotBookable(slot({ startTime: '11:59:00' }), now), false, 'past slot today')
  assert.equal(isSlotBookable(slot({ startTime: '12:00:00' }), now), false, 'slot starting right now')
  assert.equal(isSlotBookable(slot({ slotDate: '2026-10-05' }), now), false, 'yesterday')
  assert.equal(isSlotBookable(slot({ slotDate: '2026-10-07', startTime: '08:00:00' }), now), true, 'tomorrow early morning')
  assert.equal(isSlotBookable(slot({ slotDate: '2026-10-13', startTime: '08:00:00' }), now), true, 'day +7')
  assert.equal(isSlotBookable(slot({ slotDate: '2026-10-14' }), now), false, 'day +8')
  assert.equal(isSlotBookable(slot({ bookedCount: 3 }), now), false, 'full')
  assert.equal(isSlotBookable(slot({ status: 'FULL' }), now), false)
})
test('pricing mirrors server: unit = base + extras, tax = ROUND(subtotal*5%,2)', () => {
  const lines = [{ price: 100, quantity: 2 }, { price: 50, quantity: 1, options: [{ extraPrice: 20 }] }]
  assert.equal(unitPrice(lines[1]), 70); assert.equal(lineTotal(lines[0]), 200)
  assert.deepEqual(orderTotals(lines), { subtotal: 270, tax: 13.5, total: 283.5 })
  assert.deepEqual(orderTotals([{ price: 10, quantity: 1 }]), { subtotal: 10, tax: 0.5, total: 10.5 })
  assert.deepEqual(orderTotals([{ price: 33.33, quantity: 3 }]), { subtotal: 99.99, tax: 5, total: 104.99 })
  assert.equal(formatMoney(1234567), '₹1,234,567'); assert.equal(formatMoney(10.5), '₹10.50')
})
test('friendlyError never leaks raw database / gateway text', () => {
  assert.equal(friendlyError({ message: 'Insufficient stock for "Biryani".' }), 'Insufficient stock for "Biryani".')
  assert.equal(friendlyError({ code: '42501', message: 'new row violates row-level security policy for table "orders"' }), "You don't have permission to do that.")
  assert.equal(friendlyError({ message: 'duplicate key value violates unique constraint "x"', code: '23505' }), 'That has already been saved.')
  assert.match(friendlyError(new TypeError('Failed to fetch')), /Can't reach Crave/)
  assert.equal(friendlyError({ message: 'insert or update on table "x" violates foreign key constraint "y"' }), 'Something went wrong. Please try again.')
  assert.equal(friendlyError({ message: '{"error":{"code":"BAD_REQUEST_ERROR","description":"x"}}' }, 'Payment failed'), 'Payment failed')
  assert.equal(parsePaymentInProgress({ message: 'PAYMENT_IN_PROGRESS:2fe1d5ea-3841-4a43-a530-2092793a9deb' })?.orderId, '2fe1d5ea-3841-4a43-a530-2092793a9deb')
})
