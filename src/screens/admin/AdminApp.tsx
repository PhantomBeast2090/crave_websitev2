import { useEffect } from 'react'
import type { Profile } from '../../types'
import { Shell, type NavItem } from '../../shell/Shell'
import { useRouter } from '../../state/router'
import { NotFound, WrongArea } from '../shared/NotFound'
import { ProfilePage } from '../shared/Profile'
import { AdminMenu, AdminOutlets, AdminSlots } from './Catalog'
import { AdminReviews } from './Moderation'
import { AdminOrders } from './Orders'
import { AdminOverview } from './Overview'
import { AdminPayments } from './Payments'
import { AdminUsers, AdminVendors } from './People'

const nav: NavItem[] = [
  { label: 'Overview', to: '/admin', icon: '▦', match: (p) => p === '/admin' },
  { label: 'Analytics', to: '/admin/analytics', icon: '◔' },
  { label: 'Orders', to: '/admin/orders', icon: '↗' },
  { label: 'Payments', to: '/admin/payments', icon: '₹' },
  { label: 'Vendors', to: '/admin/vendors', icon: '◇' },
  { label: 'Outlets', to: '/admin/outlets', icon: '⌂' },
  { label: 'Menu', to: '/admin/menu', icon: '✚' },
  { label: 'Inventory', to: '/admin/inventory', icon: '▤' },
  { label: 'Pickup slots', to: '/admin/slots', icon: '◷' },
  { label: 'Reviews', to: '/admin/reviews', icon: '★' },
  { label: 'Users', to: '/admin/users', icon: '◎' },
]

function Routes() {
  const { segments, navigate } = useRouter()
  const [area, page] = segments
  useEffect(() => { if (!area) navigate('/admin', { replace: true }) }, [area, navigate])
  if (!area) return null
  if (area === 'profile') return <ProfilePage />
  if (area !== 'admin') return <WrongArea />
  switch (page) {
    case undefined: return <AdminOverview />
    case 'analytics': return <AdminOverview analytics />
    case 'orders': return <AdminOrders />
    case 'payments': return <AdminPayments />
    case 'vendors': return <AdminVendors />
    case 'outlets': return <AdminOutlets />
    case 'menu': return <AdminMenu />
    case 'inventory': return <AdminMenu lowOnly />
    case 'slots': return <AdminSlots />
    case 'reviews': return <AdminReviews />
    case 'users': return <AdminUsers />
    default: return <NotFound />
  }
}

export function AdminApp({ profile }: { profile: Profile }) {
  return <Shell profile={profile} nav={nav} home="/admin"><Routes /></Shell>
}
