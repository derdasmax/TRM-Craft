import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useEffect } from 'react'
import { Onboarding } from './components/Onboarding'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { UpdateDialog } from './components/UpdateDialog'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { ServerPage } from './pages/ServerPage'
import { Suspense } from 'react'
import { lazyNamed } from './lib/lazy'
const Wizard = lazyNamed(() => import('./components/Wizard'), 'Wizard')
const CommandPalette = lazyNamed(() => import('./components/CommandPalette'), 'CommandPalette')
import { useStore } from './lib/store'

function useTheme() {
  const { theme, accent, language } = useStore((s) => s.settings)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => { document.documentElement.dataset.accent = accent }, [accent])
  useEffect(() => { document.documentElement.lang = language }, [language])
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const page = useStore((s) => s.page)
  const wizardOpen = useStore((s) => s.wizardOpen)
  const toast = useStore((s) => s.toast)
  const onboardingDone = useStore((s) => s.settings.onboardingDone)
  useEffect(() => { void init() }, [init])
  const paletteOpen = useStore((s) => s.paletteOpen)
  // Globale Tastenkürzel: Strg+K Befehlspalette, Strg+N neuer Server, Strg+, Einstellungen.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const st = useStore.getState()
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); st.setPalette(!st.paletteOpen) }
      else if (e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); st.setWizard(true) }
      else if (e.key === ',') { e.preventDefault(); st.setPage('settings') }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  useTheme()
  if (!ready) return null
  return (
    // reducedMotion="user": Bewegung entfällt bei aktivierter Systemeinstellung
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={page} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}>
                {page === 'dashboard' ? <Dashboard /> : page === 'server' ? <ServerPage /> : <Settings />}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <AnimatePresence>{!onboardingDone && <Onboarding />}</AnimatePresence>
        {onboardingDone && <UpdateDialog />}
        <Suspense fallback={null}><AnimatePresence>{wizardOpen && <Wizard />}</AnimatePresence>
        {paletteOpen && <CommandPalette />}</Suspense>
        <AnimatePresence>
          {toast && (
            <motion.div key={toast} role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }} className="glass fixed bottom-6 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-ctl px-4 py-3 text-[13px]">{toast}</motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
