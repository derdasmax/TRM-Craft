import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '../lib/i18n'

/** Bebilderte Anleitung für die Portweiterleitung im Router. */
export function PortGuide({ ports, localIp, onClose }: { ports: { port: number; protocol: string }[]; localIp: string; onClose: () => void }) {
  const t = useT()
  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center bg-bg/75 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="guide-title" className="glass max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-card p-7" initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="guide-title" className="font-display text-[19px] font-semibold">{t('net.guide.title')}</h2>
          <button onClick={onClose} aria-label={t('fi.close')} className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted hover:bg-raised hover:text-fg"><X size={16} strokeWidth={1.75} /></button>
        </div>

        {/* Schema: Internet, Router, PC */}
        <svg viewBox="0 0 560 120" role="img" aria-label={`${t('net.guide.internet')} → ${t('net.guide.router')} → ${t('net.guide.pc')}`} className="mb-5 w-full">
          <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="rgb(var(--accent))" /></marker></defs>
          {[[20, t('net.guide.internet')], [210, t('net.guide.router')], [400, t('net.guide.pc')]].map(([x, label]) => (
            <g key={String(x)}><rect x={Number(x)} y="20" width="140" height="64" rx="12" fill="rgb(var(--raised))" stroke="rgb(var(--line) / 0.12)" /><text x={Number(x) + 70} y="58" textAnchor="middle" fontSize="14" fill="rgb(var(--fg))" fontFamily="inherit">{String(label)}</text></g>
          ))}
          <line x1="162" x2="206" y1="52" y2="52" stroke="rgb(var(--accent))" strokeWidth="2" markerEnd="url(#arr)" />
          <line x1="352" x2="396" y1="52" y2="52" stroke="rgb(var(--accent))" strokeWidth="2" markerEnd="url(#arr)" />
          <text x="184" y="100" textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">{ports.map((p) => `${p.protocol} ${p.port}`).join(' · ')}</text>
          <text x="374" y="100" textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">{localIp}</text>
        </svg>

        <ol className="space-y-3 text-[13.5px] leading-relaxed">
          {(['1', '2', '3', '4'] as const).map((n, i) => (
            <li key={n} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 font-mono text-[12px] text-accent">{i + 1}</span><span>{t(`net.guide.${n}` as 'net.guide.1', { ip: localIp })}</span></li>
          ))}
        </ol>
        <table className="mt-4 w-full text-[13px]"><tbody>
          {ports.map((p) => <tr key={`${p.protocol}${p.port}`} className="border-t border-line/[0.08]"><td className="py-2 font-mono tabular-nums">{p.port}</td><td className="py-2 text-muted">{p.protocol}</td><td className="py-2 text-right font-mono text-muted">{localIp}</td></tr>)}
        </tbody></table>
        <p className="mt-4 text-[12.5px] text-muted">{t('net.guide.cgnat')}</p>
      </motion.div>
    </motion.div>
  )
}
