import { motion } from 'framer-motion'
import { Cpu, HardDrive, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ServerView } from '@trm/core'
import { ServerActions } from './ServerActions'
import { StatusPill } from './StatusPill'
import { formatUptime } from '../lib/act'
import { useT } from '../lib/i18n'
import { Spark } from './Spark'
import { useStore } from '../lib/store'

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [active])
  return now
}

export function ServerCard({ s, index }: { s: ServerView; index: number }) {
  const t = useT()
  const open = useStore((x) => x.openServer)
  const now = useNow(s.status === 'running')
  const samples = useStore((x) => x.stats[s.id])
  const Stat = ({ icon: I, children }: { icon: typeof Users; children: React.ReactNode }) => (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><I size={14} strokeWidth={1.75} />{children}</span>
  )
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.04, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      onClick={() => open(s.id)}
      className="glass group cursor-pointer rounded-card p-5 transition-[transform,border-color] duration-150 ease-out hover:border-accent/30 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[16px] font-semibold"><button className="no-drag truncate text-left" onClick={(e) => { e.stopPropagation(); open(s.id) }}>{s.name}</button></h3>
          <p className="mt-0.5 font-mono text-[12px] text-muted">{s.loader} {s.mcVersion}{s.crossplay ? ' · Crossplay' : ''}</p>
        </div>
        <StatusPill status={s.status} />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        <Stat icon={Users}>{s.players.length} {t('srv.players')}</Stat>
        {s.edition === 'java' && <Stat icon={HardDrive}>{(s.ramMb / 1024).toFixed(s.ramMb % 1024 ? 1 : 0)} GB</Stat>}
        <Stat icon={Cpu}><span className="font-mono tabular-nums">:{s.port}{s.edition === 'bedrock' ? ' UDP' : ''}{s.bedrockPort ? ` · :${s.bedrockPort} UDP` : ''}</span></Stat>
        {s.startedAt && <span className="font-mono text-[12.5px] tabular-nums text-muted">{formatUptime(now - s.startedAt)}</span>}
      </div>
      {s.status === 'running' && samples && samples.length > 2 && <div className="mt-3 grid grid-cols-2 gap-3"><Spark label="CPU" unit="%" data={samples.map((x) => x.cpu)} /><Spark label="RAM" unit=" MB" data={samples.map((x) => x.ramMb)} /></div>}
      {s.status === 'crashed' && s.lastCrash && <p className="mt-3 rounded-ctl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{s.lastCrash.message}</p>}
      <div className="mt-4"><ServerActions s={s} compact /></div>
    </motion.div>
  )
}
