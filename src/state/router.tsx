import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

type RouterValue = { path: string; segments: string[]; query: URLSearchParams; navigate: (to: string, options?: { replace?: boolean }) => void }
const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search)

  useEffect(() => {
    const onPop = () => setLocation(window.location.pathname + window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === window.location.pathname + window.location.search) return
    window.history[options?.replace ? 'replaceState' : 'pushState']({}, '', to)
    setLocation(to)
    window.scrollTo({ top: 0 })
  }, [])

  const value = useMemo<RouterValue>(() => {
    const [path, search = ''] = location.split('?')
    return { path: path || '/', segments: (path || '/').split('/').filter(Boolean), query: new URLSearchParams(search), navigate }
  }, [location, navigate])

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider')
  return ctx
}

/** Real anchor (open-in-new-tab, keyboard, screen readers) that navigates without a reload. */
export function Link({ to, onClick, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter()
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || rest.target === '_blank') return
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handle} {...rest}>{children}</a>
}
