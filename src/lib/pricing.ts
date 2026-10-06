// Display-side price maths. The database recomputes everything in place_order(); these helpers
// use integer paise so the preview matches the server to the paisa (tax = ROUND(subtotal * 5%, 2)).
export const TAX_RATE = 0.05
export const MAX_LINE_QUANTITY = 20

const toPaise = (rupees: number) => Math.round(rupees * 100)
const fromPaise = (paise: number) => paise / 100

export type PricedLine = { price: number; quantity: number; options?: { extraPrice: number }[] }

export const unitPrice = (line: PricedLine) => fromPaise(toPaise(line.price) + (line.options ?? []).reduce((sum, option) => sum + toPaise(option.extraPrice), 0))
export const lineTotal = (line: PricedLine) => fromPaise(toPaise(unitPrice(line)) * line.quantity)

export function orderTotals(lines: PricedLine[]) {
  const subtotalPaise = lines.reduce((sum, line) => sum + toPaise(unitPrice(line)) * line.quantity, 0)
  const taxPaise = Math.round(subtotalPaise * TAX_RATE)
  return { subtotal: fromPaise(subtotalPaise), tax: fromPaise(taxPaise), total: fromPaise(subtotalPaise + taxPaise) }
}

export const formatMoney = (value: number) => {
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(2)
  return `₹${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}
