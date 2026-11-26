import { motion } from 'framer-motion'
import { AnimatePresence } from 'framer-motion'
import { FolderInput, Package, Plus, Server } from 'lucide-react'
import { useState } from 'react'
import { Suspense } from 'react'
import { lazyNamed } from '../lib/lazy'
const ImportDialog = lazyNamed(() => import('../components/ImportDialog'), 'ImportDialog')
const ModpackDialog = lazyNamed(() => import('../components/ModpackDialog'), 'ModpackDialog')
import { Button } from '../components/ui'
import { ServerCard } from '../components/ServerCard'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

function Stat({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3, ease: [0.23, 1, 0.32, 1] }} className="glass rounded-card p-5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 font-mono text-[28px] font-medium tabular-nums">{value}</div>
    </motion.div>
  )
}

export function Dashboard() {
  const t = useT()
  const servers = Object.values(useStore((s) => s.servers)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const setWizard = useStore((s) => s.setWizard)
  const packOpen = useStore((s) => s.packOpen)
  const [importOpen, setImportOpen] = useState(false)
  const setPackOpen = useStore((s) => s.setPack)
  const online = servers.filter((s) => s.status === 'running').length
  const players = servers.reduce((n, s) => n + s.players.length, 0)
  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-[26px] font-semibold tracking-tight">{t('dash.title')}</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setImportOpen(true)}><FolderInput size={15} strokeWidth={1.75} />{t('im.open')}</Button>
          <Button variant="ghost" onClick={() => setPackOpen(true)}><Package size={15} strokeWidth={1.75} />{t('pack.open')}</Button>
          {servers.length > 0 && <Button onClick={() => setWizard(true)}><Plus size={15} strokeWidth={2} />{t('srv.new')}</Button>}
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={t('dash.stat.servers')} value={String(servers.length)} delay={0} />
        <Stat label={t('dash.stat.online')} value={String(online)} delay={0.04} />
        <Stat label={t('dash.stat.players')} value={String(players)} delay={0.08} />
      </div>
      {servers.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.3, ease: [0.23, 1, 0.32, 1] }} className="pixel-grid hairline grid place-items-center rounded-card px-6 py-16 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-ctl bg-accent/10 text-accent"><Server size={22} strokeWidth={1.5} /></div>
            <h2 className="font-display text-[17px] font-semibold">{t('dash.empty.title')}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('dash.empty.body')}</p>
            <Button className="mt-5" onClick={() => setWizard(true)}><Plus size={15} strokeWidth={2} />{t('srv.new')}</Button>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {servers.map((s, i) => <ServerCard key={s.id} s={s} index={i} />)}
        </div>
      )}
      <Suspense fallback={null}>
        <AnimatePresence>{packOpen && <ModpackDialog onClose={() => setPackOpen(false)} />}</AnimatePresence>
        <AnimatePresence>{importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}</AnimatePresence>
      </Suspense>
    </div>
  )
}
