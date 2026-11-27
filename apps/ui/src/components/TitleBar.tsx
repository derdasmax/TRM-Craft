import { Cloud, CloudOff, Minus, Square, Copy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { invoke, onEvent } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

function Logo() {
  // Minecraft-Bezug dezent: 3x3-Pixelblock
  const cells = [1, 1, 1, 1, 0, 1, 1, 1, 1]
  return (
    <div className="grid h-[18px] w-[18px] grid-cols-3 gap-px" aria-hidden>
      {cells.map((c, i) => (
        <i key={i} className={c ? (i % 2 ? 'bg-accent/70' : 'bg-accent') : ''} style={{ borderRadius: 1 }} />
      ))}
    </div>
  )
}

/** Kleine Fortschrittsanzeige, solange ein Update im Hintergrund lädt. */
function UpdatePill() {
  const t = useT()
  const u = useStore((s) => s.updater)
  const dismissed = useStore((s) => s.dismissedVersion)
  const show = useStore((s) => s.dismiss)
  if (u?.phase !== 'downloading' || !u.version || dismissed !== u.version) return null
  const p = Math.round(u.percent ?? 0)
  return (
    <button onClick={() => show('')} title={t('upd.title.downloading')} className="no-drag relative ml-4 inline-flex h-6 items-center gap-2 overflow-hidden rounded-full bg-raised/70 px-3 text-[11.5px] text-fg">
      <span className="absolute inset-y-0 left-0 bg-accent/25 transition-[width] duration-500" style={{ width: `${p}%` }} />
      <span className="relative tabular-nums">{t('upd.pill', { p })}</span>
    </button>
  )
}

/** CPU- und RAM-Auslastung des PCs. */
function UsageMeter() {
  const u = useStore((s) => s.usage)
  if (!u) return null
  const gb = (mb: number) => (mb / 1024).toFixed(1)
  const hot = (v: number) => (v >= 90 ? 'text-danger' : v >= 75 ? 'text-warn' : 'text-fg')
  const ramPct = Math.round((u.ramUsedMb / u.ramTotalMb) * 100)
  return (
    <div className="ml-4 flex items-center gap-3 text-[11.5px] tabular-nums text-muted" role="status" aria-label={`CPU ${u.cpu}%, RAM ${ramPct}%`}>
      <span>CPU <b className={`font-medium ${hot(u.cpu)}`}>{u.cpu}%</b></span>
      <span>RAM <b className={`font-medium ${hot(ramPct)}`}>{gb(u.ramUsedMb)}</b>/{gb(u.ramTotalMb)} GB</span>
    </div>
  )
}

/** „Fernzugriff aktiv“ in der Titelleiste, solange die API läuft. Warnfarbe, wenn der Tunnel getrennt ist. */
function RemoteBadge() {
  const t = useT()
  const r = useStore((s) => s.remote)
  const setPage = useStore((s) => s.setPage)
  if (!r?.enabled || !r.listening) return null
  const down = r.mode === 'tunnel' && !!r.tunnel.host && r.tunnel.phase !== 'connected' && !r.tunnel.serviceInstalled
  const label = down ? t('rm.bar.down') : t('rm.bar.active')
  return (
    <button onClick={() => setPage('settings')} title={r.publicUrl ?? label} className="no-drag ml-4 inline-flex h-6 items-center gap-1.5 rounded-full bg-raised/70 px-2.5 text-[11.5px] text-muted transition-colors hover:text-fg">
      {down ? <CloudOff size={13} strokeWidth={1.75} className="text-warn" /> : <Cloud size={13} strokeWidth={1.75} className="text-accent" />}
      <span className="hidden sm:inline" role="status">{label}</span>
    </button>
  )
}

export function TitleBar() {
  const t = useT()
  const [max, setMax] = useState(false)
  useEffect(() => {
    invoke('window.isMaximized').then(setMax)
    return onEvent('window.maximized', setMax)
  }, [])
  const btn = 'no-drag grid h-full w-12 place-items-center text-muted transition-colors duration-150 hover:bg-raised hover:text-fg'
  return (
    <header className="drag flex h-10 shrink-0 items-center justify-between border-b border-line/[0.06] bg-bg" onDoubleClick={() => invoke('window.toggleMaximize')}>
      <div className="flex items-center gap-2.5 pl-4">
        <Logo />
        <span className="font-display text-[12px] font-semibold tracking-[0.16em]">TRM-CRAFT</span>
        <RemoteBadge />
        <UpdatePill />
        <UsageMeter />
      </div>
      <div className="flex h-full" onDoubleClick={(e) => e.stopPropagation()}>
        <button className={btn} aria-label={t('win.minimize')} onClick={() => invoke('window.minimize')}><Minus size={15} strokeWidth={1.75} /></button>
        <button className={btn} aria-label={t('win.maximize')} onClick={() => invoke('window.toggleMaximize')}>
          {max ? <Copy size={12} strokeWidth={1.75} /> : <Square size={12} strokeWidth={1.75} />}
        </button>
        <button className={`${btn} hover:!bg-danger hover:!text-white`} aria-label={t('win.close')} onClick={() => invoke('window.close')}><X size={16} strokeWidth={1.75} /></button>
      </div>
    </header>
  )
}
