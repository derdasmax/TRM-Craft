import { motion } from 'framer-motion'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from './ui'
import { invoke } from '../lib/bridge'
import { parseChangelog } from '../lib/markdown'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

export function UpdateDialog() {
  const t = useT()
  const u = useStore((s) => s.updater)
  const dismissed = useStore((s) => s.dismissedVersion)
  const dismiss = useStore((s) => s.dismiss)
  if (!u?.version) return null
  const interactive = u.phase === 'available' || u.phase === 'ready' || u.phase === 'countdown' || u.phase === 'installing'
  if (!interactive || (dismissed === u.version && u.phase !== 'countdown' && u.phase !== 'installing')) return null

  const blocks = parseChangelog(u.notes ?? '')
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="upd-title" className="glass flex max-h-[80vh] w-full max-w-lg flex-col rounded-card p-7" initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-ctl bg-accent/10 text-accent"><Download size={19} strokeWidth={1.75} /></div>
          <div>
            <h2 id="upd-title" className="font-display text-[18px] font-semibold">{t('upd.dialog.title')}</h2>
            <p className="font-mono text-[12px] text-muted">{u.currentVersion} → {u.version}</p>
          </div>
        </div>

        <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{t('upd.dialog.changelog')}</h3>
        <div className="min-h-0 flex-1 select-text overflow-y-auto rounded-ctl bg-raised/50 p-4 text-[13px] leading-relaxed">
          {blocks.length === 0 ? <p className="text-muted">{t('upd.dialog.nonotes')}</p> : blocks.map((b, i) =>
            b.type === 'h' ? <h4 key={i} className="mb-1 mt-3 first:mt-0 font-semibold">{b.text}</h4>
            : b.type === 'li' ? <p key={i} className="pl-3 text-muted before:mr-2 before:content-['•']">{b.text}</p>
            : <p key={i} className="text-muted">{b.text}</p>)}
        </div>

        {u.phase === 'countdown' && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-ctl bg-warn/10 px-4 py-3 text-[13px]" role="status">
            <span>{t('upd.countdown', { s: u.secondsLeft ?? 0 })}</span>
            <Button variant="ghost" onClick={() => invoke('updater.skipCountdown')}>{t('upd.skip')}</Button>
          </div>
        )}
        {u.phase === 'installing' && <p className="mt-4 text-[13px] text-muted" role="status">{t('upd.installing')}</p>}

        {(u.phase === 'available' || u.phase === 'ready') && (
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dismiss(u.version!)}>{t('upd.dialog.later')}</Button>
            {u.phase === 'available'
              ? <Button onClick={() => invoke('updater.download')}><Download size={15} />{t('upd.dialog.now')}</Button>
              : <Button onClick={() => invoke('updater.installNow')}><RefreshCw size={15} />{t('upd.dialog.restart')}</Button>}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
