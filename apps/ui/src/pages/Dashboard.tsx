import { motion } from 'framer-motion'
import { Server } from 'lucide-react'
import { useT } from '../lib/i18n'

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
  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-6 font-display text-[26px] font-semibold tracking-tight">{t('dash.title')}</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={t('dash.stat.servers')} value="0" delay={0} />
        <Stat label={t('dash.stat.online')} value="0" delay={0.04} />
        <Stat label={t('dash.stat.players')} value="0" delay={0.08} />
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.3, ease: [0.23, 1, 0.32, 1] }} className="pixel-grid hairline grid place-items-center rounded-card px-6 py-16 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-ctl bg-accent/10 text-accent"><Server size={22} strokeWidth={1.5} /></div>
          <h2 className="font-display text-[17px] font-semibold">{t('dash.empty.title')}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('dash.empty.body')}</p>
        </div>
      </motion.div>
    </div>
  )
}
