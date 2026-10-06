export type Tone = 'tangerine' | 'chartreuse' | 'lavender' | 'aqua' | 'sun'
export type Role = 'STUDENT' | 'VENDOR' | 'ADMIN' | 'PENDING_VENDOR'

export type Profile = { id: string; name: string; email: string; role: Role; isActive: boolean; phone?: string | null }

export type CustomizationOption = { id: string; variantId: string; variantName: string; name: string; extraPrice: number }
export type CustomizationGroup = { id: string; name: string; isRequired: boolean; maxSelections: number; options: CustomizationOption[] }
export type Category = { id: string; label: string; emoji: string }

export type Food = {
  id: string
  outletId: string
  outletName?: string
  name: string
  description: string
  categoryId: string
  categoryName?: string
  price: number
  rating: number
  reviewCount: number
  prepMinutes: number
  emoji: string
  tone: Tone
  imageUrl?: string | null
  isVeg: boolean
  isAvailable: boolean
  tag?: string
  popular?: boolean
  /** null = unknown / effectively unlimited. Only small numbers are shown to students. */
  stock: number | null
  groups: CustomizationGroup[]
}

export type Outlet = {
  id: string
  name: string
  location: string
  rating: number
  reviewCount: number
  emoji: string
  tone: Tone
  isOpen: boolean
  description: string
  imageUrl?: string | null
  vendorId?: string | null
  opensAt?: string
  closesAt?: string
}

export type CartLine = {
  key: string
  foodId: string
  outletId: string
  outletName?: string
  name: string
  emoji: string
  tone: Tone
  imageUrl?: string | null
  isVeg: boolean
  price: number
  quantity: number
  options: CustomizationOption[]
  note?: string
}

export type OrderStatus = 'CREATED' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'
export type PaymentStatus = 'PENDING' | 'CREATED' | 'AUTHORIZED' | 'PAID' | 'CAPTURED' | 'FAILED' | 'REFUNDED'

export type OrderItem = { id: string; foodItemId: string; name: string; quantity: number; unitPrice: number; totalPrice: number; note?: string | null; options: string[] }

export type Order = {
  id: string
  number: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: 'PAY_AT_COUNTER' | 'ONLINE'
  subtotal: number
  tax: number
  total: number
  outletId: string
  outletName: string
  customerName?: string
  createdAt: string
  acceptedAt?: string | null
  preparingAt?: string | null
  readyAt?: string | null
  pickedUpAt?: string | null
  cancelledAt?: string | null
  cancellationReason?: string | null
  paymentExpiresAt?: string | null
  slotDate?: string
  slotStart?: string
  slotEnd?: string
  token?: string | null
  tokenUsed?: boolean
  items: OrderItem[]
}
