import { useState, type FormEvent, type ReactNode } from 'react'
import type { Profile } from '../types'
import { initials } from '../lib/ui-helpers'
import { useCart } from '../state/cart'
import { Link, useRouter } from '../state/router'

export type NavItem = { label: string; to: string; icon: string; match?: (path: string) => boolean }
const isActive = (item: NavItem, path: string) => item.match ? item.match(path) : item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`)

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-mark ${compact ? 'brand-compact' : ''}`} role="img" aria-label="Crave"><span className="brand-glyph" aria-hidden="true">C</span><span className="brand-word" aria-hidden="true">RAVE</span><span className="brand-spark" aria-hidden="true">✦</span></span>
}

const roleName = (role: Profile['role']) => role === 'ADMIN' ? 'Management' : role === 'VENDOR' ? 'Vendor' : role === 'PENDING_VENDOR' ? 'Vendor (pending)' : 'Student'

export function Shell({ profile, nav, home, rail, searchable, children }: { profile: Profile; nav: NavItem[]; home: string; rail?: ReactNode; searchable?: boolean; children: ReactNode }) {
  const { path } = useRouter()
  return <div className={`app-frame ${rail ? '' : 'no-rail'}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="grain" aria-hidden="true" />
    <aside className="sidebar">
      <Link to={home} className="brand-button" aria-label="Crave home"><BrandMark /></Link>
      <div className="campus-chip"><span className="pulse-dot" aria-hidden="true" /> SRMIST</div>
      <div className="sidebar-rule" />
      <p className="eyebrow sidebar-label">{profile.role === 'STUDENT' ? 'Your campus' : `${roleName(profile.role)} workspace`}</p>
      <nav className="side-nav" aria-label="Main">
        {nav.map((item) => <Link key={item.to} to={item.to} className={`side-nav-item ${isActive(item, path) ? 'nav-active' : ''}`} aria-current={isActive(item, path) ? 'page' : undefined}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{isActive(item, path) && <span className="nav-notch" aria-hidden="true" />}
        </Link>)}
      </nav>
      <div className="sidebar-spacer" />
      <Link to="/profile" className="profile-mini"><span className="avatar" aria-hidden="true">{initials(profile.name)}</span><span><strong>{profile.name}</strong><span>{roleName(profile.role)}</span></span></Link>
    </aside>
    <main className="workspace" id="main" tabIndex={-1}>
      <Topbar profile={profile} searchable={searchable} />
      <div className="content-wrap">{children}</div>
    </main>
    {rail}
    <nav className={`mobile-nav ${nav.length > 5 ? 'mobile-nav-scroll' : ''}`} aria-label="Main (mobile)">
      {nav.map((item) => <Link key={item.to} to={item.to} className={isActive(item, path) ? 'mobile-active' : ''} aria-current={isActive(item, path) ? 'page' : undefined}>
        <span className="mobile-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
      </Link>)}
      <Link to="/profile" className={path === '/profile' ? 'mobile-active' : ''}><span className="mobile-icon" aria-hidden="true">◎</span><span>Profile</span></Link>
    </nav>
  </div>
}

function Topbar({ profile, searchable }: { profile: Profile; searchable?: boolean }) {
  const { navigate } = useRouter()
  const [query, setQuery] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); const q = query.trim(); navigate(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore') }
  return <header className="topbar">
    <div className="mobile-brand"><BrandMark compact /></div>
    <div className="breadcrumbs"><span>Crave</span><span className="crumb-slash" aria-hidden="true">/</span><strong>{roleName(profile.role)}</strong></div>
    <div className="top-actions">
      {searchable && <form className="top-search" role="search" onSubmit={submit}><span aria-hidden="true">⌕</span><input aria-label="Search food" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a craving…" maxLength={60} /></form>}
      {searchable && <CartPill />}
    </div>
  </header>
}

function CartPill() {
  const { count } = useCart()
  return <Link to="/cart" className="cart-pill"><span>Bag</span><strong>{count}<span className="visually-hidden"> item{count === 1 ? '' : 's'}</span></strong><span className="cart-arrow" aria-hidden="true">↗</span></Link>
}
