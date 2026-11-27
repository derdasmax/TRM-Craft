import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, Download, Info, Loader2, RefreshCw, Sparkles, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import clsx from 'clsx'
import type { UpdaterState } from '@trm/core'
import { Button } from './ui'
import { invoke } from '../lib/bridge'
import { parseChangelog } from '../lib/markdown'
import { useT, type Key } from '../lib/i18n'
import { useStore } from '../lib/store'

const EASE = [0.23, 1, 0.32, 1] as const

type Group = { title: string; kind: 'new' | 'fix' | 'other'; items: string[] }

/** Gruppiert den Changelog nach seinen Überschriften („Neu“, „Fehlerbehebungen“ …). */
function groupChangelog(notes: string): Group[] {
  const groups: Group[] = []
  let cur: Group | null = null
  for (const b of parseChangelog(notes)) {
    if (b.type === 'h') {
      cur = { title: b.text, kind: /fehler|fix|bug/i.test(b.text) ? 'fix' : /neu|feature|new|added/i.test(b.text) ? 'new' : 'other', items: [] }
      groups.push(cur)
    } else {
      if (!cur) { cur = { title: '', kind: 'other', items: [] }; groups.push(cur) }
      cur.items.push(b.text)
    }
  }
  return groups.filter((g) => g.items.length)
}

const GROUP_ICON = { new: Sparkles, fix: Wrench, other: Info } as const

/** Weiche Farbflächen im Hintergrund. Stehen still, wenn der Nutzer weniger Bewegung wünscht. */
function Aurora({ still }: { still: boolean }) {
  const drift = (x: number[], y: number[], d: number) => (still ? undefined : { x, y, transition: { duration: d, repeat: Infinity, repeatType: 'mirror' as const, ease: 'easeInOut' as const } })
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-card" aria-hidden>
      <motion.div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-accent/25 blur-[70px]" animate={drift([0, 40, 0], [0, 30, 0], 9)} />
      <motion.div className="absolute -bottom-24 -right-10 h-60 w-60 rounded-full bg-accent/15 blur-[80px]" animate={drift([0, -30, 0], [0, -24, 0], 11)} />
      <div className="absolute inset-0 bg-[linear-gradient(rgb(var(--line)/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--line)/0.035)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
    </div>
  )
}

/** Symbol mit umlaufendem Ring. */
function Emblem({ phase, still }: { phase: UpdaterState['phase']; still: boolean }) {
  const busy = phase === 'downloading' || phase === 'installing'
  return (
    <div className="relative grid h-12 w-12 place-items-center">
      <motion.span
        className="absolute inset-0 rounded-full border border-dashed border-accent/50"
        animate={still ? undefined : { rotate: 360 }}
        transition={{ duration: busy ? 4 : 14, repeat: Infinity, ease: 'linear' }}
      />
      <span className="absolute inset-[5px] rounded-full bg-accent/10" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={phase === 'ready' ? 'ok' : phase === 'installing' ? 'busy' : 'dl'} className="relative text-accent" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.2 }}>
          {phase === 'ready' ? <Check size={20} strokeWidth={2.25} /> : phase === 'installing' ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} strokeWidth={1.75} />}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

/** Alte → neue Version mit wanderndem Pfeil. */
function VersionFlow({ from, to, still }: { from: string; to: string; still: boolean }) {
  return (
    <div className="mt-5 flex items-center justify-center gap-3 font-mono text-[13px]">
      <span className="hairline rounded-full bg-raised/60 px-3 py-1 text-muted">{from}</span>
      <span className="relative h-px w-14 overflow-hidden bg-line/15">
        <motion.span className="absolute inset-y-0 w-6 bg-gradient-to-r from-transparent via-accent to-transparent" animate={still ? undefined : { x: [-24, 56] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
      </span>
      <ArrowRight size={14} className="-ml-1 text-accent" />
      <span className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 font-medium text-accent shadow-[0_0_18px_-4px_rgb(var(--accent)/0.6)]">{to}</span>
    </div>
  )
}

/** Drei Schritte: Laden → Bereit → Installieren. */
function Steps({ phase }: { phase: UpdaterState['phase'] }) {
  const t = useT()
  const index = phase === 'available' || phase === 'downloading' ? 0 : phase === 'ready' ? 1 : 2
  const labels: Key[] = ['upd.step.download', 'upd.step.ready', 'upd.step.install']
  return (
    <ol className="mt-6 flex items-center" aria-label="Fortschritt">
      {labels.map((k, i) => (
        <li key={k} className={clsx('flex items-center', i < 2 && 'flex-1')} aria-current={i === index ? 'step' : undefined}>
          <motion.span
            className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold', i <= index ? 'bg-accent text-accent-fg' : 'hairline bg-raised/60 text-muted')}
            animate={{ scale: i === index ? 1.12 : 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          >
            {i < index ? <Check size={13} strokeWidth={3} /> : i + 1}
          </motion.span>
          <span className={clsx('ml-2 text-[12px]', i === index ? 'text-fg' : 'text-muted')}>{t(k)}</span>
          {i < 2 && (
            <span className="mx-3 h-px flex-1 overflow-hidden bg-line/15">
              <motion.span className="block h-full origin-left bg-accent" initial={false} animate={{ scaleX: i < index ? 1 : 0 }} transition={{ duration: 0.5, ease: EASE }} />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Ring mit Prozentzahl, optional mit Text in der Mitte. */
function Ring({ value, label, sub, still }: { value: number; label: string; sub?: string; still: boolean }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <div className="relative mx-auto grid h-36 w-36 place-items-center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--line) / 0.1)" strokeWidth="7" />
        <motion.circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--accent))" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, value)) / 100) }} transition={{ duration: still ? 0 : 0.5, ease: EASE }} style={{ filter: 'drop-shadow(0 0 6px rgb(var(--accent) / 0.55))' }} />
      </svg>
      <div className="text-center">
        <div className="font-display text-[28px] font-semibold tabular-nums leading-none">{label}</div>
        {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
      </div>
    </div>
  )
}

/** Kleine Funken beim Erfolg. */
function Burst({ still }: { still: boolean }) {
  if (still) return null
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        return <motion.span key={i} className="absolute h-1.5 w-1.5 rounded-full bg-accent" initial={{ x: 0, y: 0, opacity: 1, scale: 1 }} animate={{ x: Math.cos(a) * 74, y: Math.sin(a) * 74, opacity: 0, scale: 0.3 }} transition={{ duration: 0.9, ease: 'easeOut', delay: 0.05 }} />
      })}
    </div>
  )
}

function SuccessMark({ still }: { still: boolean }) {
  return (
    <div className="relative mx-auto grid h-36 w-36 place-items-center">
      <motion.div className="absolute inset-3 rounded-full bg-accent/10" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4, ease: EASE }} />
      <svg viewBox="0 0 120 120" className="relative h-28 w-28">
        <motion.circle cx="60" cy="60" r="50" fill="none" stroke="rgb(var(--accent))" strokeWidth="5" strokeLinecap="round" pathLength={1} strokeDasharray={1} initial={{ strokeDashoffset: still ? 0 : 1 }} animate={{ strokeDashoffset: 0 }} transition={{ duration: 0.6, ease: EASE }} />
        <motion.path d="M38 62 L54 77 L83 45" fill="none" stroke="rgb(var(--accent))" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} initial={{ strokeDashoffset: still ? 0 : 1 }} animate={{ strokeDashoffset: 0 }} transition={{ duration: 0.45, ease: EASE, delay: still ? 0 : 0.45 }} />
      </svg>
      <Burst still={still} />
    </div>
  )
}

function Changelog({ notes }: { notes: string }) {
  const t = useT()
  const groups = useMemo(() => groupChangelog(notes), [notes])
  return (
    <div className="min-h-0 flex-1 select-text space-y-4 overflow-y-auto pr-1">
      {groups.length === 0 ? <p className="text-[13px] text-muted">{t('upd.dialog.nonotes')}</p> : groups.map((g, gi) => {
        const Icon = GROUP_ICON[g.kind]
        return (
          <motion.section key={gi} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE, delay: 0.08 * gi }}>
            <h4 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span className={clsx('grid h-5 w-5 place-items-center rounded-md', g.kind === 'fix' ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent')}><Icon size={12} strokeWidth={2} /></span>
              {g.title || t('upd.dialog.changelog')}
            </h4>
            <ul className="space-y-1.5">
              {g.items.map((it, i) => (
                <motion.li key={i} className="hairline rounded-ctl bg-raised/40 px-3 py-2 text-[13px] leading-snug" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.08 * gi + 0.04 * i }}>{it}</motion.li>
              ))}
            </ul>
          </motion.section>
        )
      })}
    </div>
  )
}

const speed = (bps?: number) => (bps ? `${(bps / 1048576).toFixed(1)} MB/s` : undefined)

export function UpdateDialog() {
  const t = useT()
  const still = !!useReducedMotion()
  const u = useStore((s) => s.updater)
  const dismissed = useStore((s) => s.dismissedVersion)
  const dismiss = useStore((s) => s.dismiss)
  if (!u?.version) return null
  const live = u.phase === 'countdown' || u.phase === 'installing'
  const interactive = u.phase === 'available' || u.phase === 'downloading' || u.phase === 'ready' || live
  if (!interactive || (dismissed === u.version && !live)) return null
  const phase = u.phase

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-6 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="upd-title" className="glass relative flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-card p-7" initial={{ opacity: 0, scale: 0.94, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
        <Aurora still={still} />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-4">
            <Emblem phase={phase} still={still} />
            <div>
              <h2 id="upd-title" className="font-display text-[19px] font-semibold">
                {phase === 'downloading' ? t('upd.title.downloading') : phase === 'ready' ? t('upd.title.ready') : live ? t('upd.title.installing') : t('upd.dialog.title')}
              </h2>
              <p className="text-[12.5px] text-muted">{phase === 'ready' ? t('upd.sub.ready') : phase === 'downloading' ? t('upd.sub.downloading') : phase === 'available' ? t('upd.sub.available') : t('upd.sub.installing')}</p>
            </div>
          </div>

          <VersionFlow from={u.currentVersion} to={u.version} still={still} />
          <Steps phase={phase} />

          <div className="mt-6 flex min-h-0 flex-1 flex-col">
            <AnimatePresence mode="wait" initial={false}>
              {phase === 'available' && (
                <motion.div key="notes" className="flex min-h-0 flex-1 flex-col" exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                  <Changelog notes={u.notes ?? ''} />
                </motion.div>
              )}
              {phase === 'downloading' && (
                <motion.div key="dl" className="py-2" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }}>
                  <Ring value={u.percent ?? 0} label={`${Math.round(u.percent ?? 0)} %`} sub={speed(u.bytesPerSecond)} still={still} />
                </motion.div>
              )}
              {phase === 'ready' && (
                <motion.div key="ok" className="py-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <SuccessMark still={still} />
                </motion.div>
              )}
              {live && (
                <motion.div key="live" className="py-2" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  {phase === 'countdown'
                    ? <Ring value={((u.secondsLeft ?? 0) / 30) * 100} label={String(u.secondsLeft ?? 0)} sub={t('upd.seconds')} still={still} />
                    : <div className="grid h-36 place-items-center"><Loader2 size={40} className="animate-spin text-accent" /></div>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {phase === 'countdown' && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-ctl bg-warn/10 px-4 py-3 text-[13px]" role="status">
              <span>{t('upd.countdown', { s: u.secondsLeft ?? 0 })}</span>
              <Button variant="ghost" onClick={() => invoke('updater.skipCountdown')}>{t('upd.skip')}</Button>
            </div>
          )}
          {phase === 'installing' && <p className="mt-4 text-center text-[13px] text-muted" role="status">{t('upd.installing')}</p>}

          {(phase === 'available' || phase === 'ready' || phase === 'downloading') && (
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => dismiss(u.version!)}>{phase === 'downloading' ? t('upd.background') : t('upd.dialog.later')}</Button>
              {phase === 'available' && <Button onClick={() => invoke('updater.download')}><Download size={15} />{t('upd.dialog.now')}</Button>}
              {phase === 'ready' && <Button onClick={() => invoke('updater.installNow')}><RefreshCw size={15} />{t('upd.dialog.restart')}</Button>}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
