import { Activity, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { recommendRamMb, type ServerView, type StatsSample } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { loadStats, useStore } from '../lib/store'

const EMPTY: StatsSample[] = []
const NO_LOGS: string[] = []

/** Kleines Flächendiagramm. Eine Datenreihe, Akzentfarbe, wenige ruhige Hilfslinien. */
function Chart({ title, unit, data, max, fixed = 0 }: { title: string; unit: string; data: (number | undefined)[]; max?: number; fixed?: number }) {
  const W = 320, H = 96, P = 4
  const pts = data.filter((v): v is number => v !== undefined)
  const top = max ?? Math.max(1, ...pts) * 1.15
  const n = Math.max(2, data.length)
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P)
  const y = (v: number) => H - P - (Math.min(v, top) / top) * (H - 2 * P)
  const coords = data.map((v, i) => (v === undefined ? null : ([x(i), y(v)] as const)))
  const line = coords.filter(Boolean).map((c, i) => `${i ? 'L' : 'M'}${c![0].toFixed(1)},${c![1].toFixed(1)}`).join(' ')
  const first = coords.find(Boolean)
  const lastC = [...coords].reverse().find(Boolean)
  const area = line && first && lastC ? `${line} L${lastC[0].toFixed(1)},${H - P} L${first[0].toFixed(1)},${H - P} Z` : ''
  const last = pts.at(-1)
  return (
    <figure className="glass rounded-card p-4">
      <figcaption className="mb-2 flex items-baseline justify-between"><span className="text-[12.5px] text-muted">{title}</span><span className="font-mono text-[18px] tabular-nums">{last === undefined ? '–' : last.toFixed(fixed)}<span className="ml-1 text-[12px] text-muted">{unit}</span></span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${last === undefined ? '–' : last.toFixed(fixed)} ${unit}`} className="h-24 w-full">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - 2 * P)} y2={H - P - f * (H - 2 * P)} stroke="rgb(var(--line) / 0.07)" />)}
        {area && <path d={area} fill="rgb(var(--accent) / 0.14)" />}
        {line && <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
    </figure>
  )
}

export function PerfTab({ server }: { server: ServerView }) {
  const t = useT()
  const data = useStore((s) => s.stats[server.id]) ?? EMPTY
  const logs = useStore((s) => s.logs[server.id]) ?? NO_LOGS
  const [recGb, setRecGb] = useState<string | null>(null)
  useEffect(() => { void loadStats(server.id) }, [server.id])
  useEffect(() => { invoke('system.memory').then((m) => setRecGb((recommendRamMb(m.totalMb) / 1024).toFixed(0))) }, [])
  const report = useMemo(() => [...logs].reverse().map((l) => /https:\/\/spark\.lucko\.me\/\w+/.exec(l)?.[0]).find(Boolean), [logs])
  const live = server.status === 'running'
  const hasTps = server.loader === 'paper' || server.loader === 'purpur'
  const cores = navigator.hardwareConcurrency || 4

  return (
    <div className="space-y-6">
      {data.length === 0 ? <div className="pixel-grid hairline grid place-items-center gap-2 rounded-card px-6 py-12 text-center text-[13px] text-muted"><Activity size={22} strokeWidth={1.5} />{t('pf.noData')}</div> : (
        <div className="grid gap-4 md:grid-cols-2">
          <Chart title={t('pf.cpu')} unit="%" data={data.map((s) => s.cpu)} max={cores * 100} />
          <Chart title={t('pf.ram')} unit="MB" data={data.map((s) => s.ramMb)} max={server.edition === 'java' ? server.ramMb * 1.1 : undefined} />
          {hasTps && <Chart title={t('pf.tps')} unit="" data={data.map((s) => s.tps)} max={20} fixed={1} />}
          <Chart title={t('pf.players')} unit="" data={data.map((s) => s.players)} />
        </div>
      )}
      <p className="text-[12px] text-muted">{t('pf.coreNote')} {!hasTps && server.edition === 'java' && t('pf.tpsNote')} {recGb && t('pf.rec', { r: recGb })}</p>

      {server.edition === 'java' && !['velocity', 'waterfall', 'bungeecord', 'vanilla'].includes(server.loader) && (
        <section className="glass rounded-card p-5">
          <h3 className="font-display text-[15px] font-semibold">{t('pf.spark')}</h3>
          <p className="mt-1 text-[12.5px] text-muted">{t('pf.spark.hint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void act(() => invoke('mods.install', { id: server.id, source: 'modrinth', projectId: 'spark' }))}>{t('pf.spark.install')}</Button>
            <Button disabled={!live} onClick={() => act(() => invoke('spark.profiler', { id: server.id, action: 'start' }))}>{t('pf.spark.start')}</Button>
            <Button variant="ghost" disabled={!live} onClick={() => act(() => invoke('spark.profiler', { id: server.id, action: 'stop' }))}>{t('pf.spark.stop')}</Button>
            {report && <Button variant="ghost" onClick={() => invoke('shell.openExternal', report)}><ExternalLink size={14} />{t('pf.spark.report')}</Button>}
          </div>
        </section>
      )}
    </div>
  )
}
