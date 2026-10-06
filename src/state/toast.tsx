import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type ToastTone = 'orange' | 'ink' | 'green' | 'red'
type ToastApi = { show: (message: string, tone?: ToastTone) => void }
const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((message: string, tone: ToastTone = 'ink') => {
    setToast({ message, tone })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), tone === 'red' ? 5200 : 3000)
  }, [])
  return <ToastContext.Provider value={{ show }}>
    {children}
    <div className="toast-region" role="status" aria-live="polite">{toast && <div className={`toast toast-${toast.tone}`}><span className="toast-dot" />{toast.message}</div>}</div>
  </ToastContext.Provider>
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
