import { LayoutDashboard, Settings } from 'lucide-react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { useStore } from '../lib/store'
import { useT, type Key } from '../lib/i18n'

const items: { id: 'dashboard' | 'settings'; icon: typeof Settings; label: Key }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
  { id: 'settings', icon: Settings, label: 'nav.settings' },
]

export function Sidebar() {
  const page = useStore((s) => s.page)
  const setPage = useStore((s) => s.setPage)
  const t = useT()
  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line/[0.06] bg-bg py-3 lg:w-[200px] lg:items-stretch lg:px-3" aria-label="Navigation">
      {items.map((it) => {
        const active = page === it.id || (it.id === 'dashboard' && page === 'server')
        return (
          <button
            key={it.id}
            onClick={() => setPage(it.id)}
            aria-current={active ? 'page' : undefined}
            title={t(it.label)}
            className={clsx('relative flex h-10 w-10 items-center gap-3 rounded-ctl px-[11px] text-[13.5px] transition-colors duration-150 lg:w-auto', active ? 'text-fg' : 'text-muted hover:text-fg')}
          >
            {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-ctl bg-raised hairline" transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }} />}
            <it.icon size={18} strokeWidth={1.75} className="relative shrink-0" style={active ? { color: 'rgb(var(--accent))' } : undefined} />
            <span className="relative hidden lg:inline">{t(it.label)}</span>
          </button>
        )
      })}
    </nav>
  )
}
