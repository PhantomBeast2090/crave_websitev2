import type { Profile } from '../../types'
import { Shell, type NavItem } from '../../shell/Shell'
import { useRouter } from '../../state/router'
import { NotFound, WrongArea } from '../shared/NotFound'
import { ProfilePage } from '../shared/Profile'
import { VendorBoard } from './Board'
import { VendorProvider } from './context'
import { VendorHistory } from './History'
import { VendorInsights } from './Insights'
import { VendorMenu } from './Menu'
import { VendorReviews } from './Reviews'
import { useEffect } from 'react'

const nav: NavItem[] = [
  { label: 'Live board', to: '/vendor', icon: '▦', match: (p) => p === '/vendor' },
  { label: 'History', to: '/vendor/history', icon: '↗' },
  { label: 'Menu & stock', to: '/vendor/menu', icon: '✚' },
  { label: 'Reviews', to: '/vendor/reviews', icon: '★' },
  { label: 'Insights', to: '/vendor/insights', icon: '◔' },
]

function Routes({ vendorId }: { vendorId: string }) {
  const { segments, navigate } = useRouter()
  const [area, page] = segments
  useEffect(() => { if (!area) navigate('/vendor', { replace: true }) }, [area, navigate])
  if (!area) return null
  if (area === 'profile') return <ProfilePage />
  if (area === 'admin') return <WrongArea />
  if (area !== 'vendor') return <WrongArea />   // student pages are not part of the vendor workspace
  return <VendorProvider vendorId={vendorId}>{(() => {
    switch (page) {
      case undefined: return <VendorBoard />
      case 'history': return <VendorHistory />
      case 'menu': return <VendorMenu />
      case 'reviews': return <VendorReviews />
      case 'insights': return <VendorInsights />
      default: return <NotFound />
    }
  })()}</VendorProvider>
}

export function VendorApp({ profile }: { profile: Profile }) {
  return <Shell profile={profile} nav={nav} home="/vendor"><Routes vendorId={profile.id} /></Shell>
}
