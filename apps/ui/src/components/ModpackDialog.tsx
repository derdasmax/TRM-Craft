import { motion } from 'framer-motion'
import { Check, FileArchive, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { recommendRamMb, type ModHit, type ModpackSource } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke, pathForFile } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-10 w-full select-text rounded-ctl bg-raised/60 px-3.5 text-[13.5px] outline-none transition-colors placeholder:text-muted focus:border-accent/50'

export function ModpackDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const openServer = useStore((s) => s.openServer)
  const notify = useStore((s) => s.notify)
  const progress = useStore((s) => s.progress)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModHit[]>([])
  const [source, setSource] = useState<ModpackSource | null>(null)
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [ram, setRam] = useState(6144)
  const [eula, setEula] = useState(false)
  const [busy, setBusy] = useState(false)
  const [token] = useState(() => `pack-${Date.now()}`)
  const p = progress[token]

  useEffect(() => { invoke('system.memory').then((m) => setRam(Math.max(4096, recommendRamMb(m.totalMb)))) }, [])
  useEffect(() => {
    const h = setTimeout(async () => { const r = await act(() => invoke('mods.search', { source: 'modrinth', kind: 'modpack', query, offset: 0 })); setHits(r?.hits ?? []) }, 350)
    return () => clearTimeout(h)
  }, [query])

  const go = async () => {
    if (!source) return
    setBusy(true)
    const r = await act(() => invoke('modpacks.install', { token, source, name: name.trim(), ramMb: ram, acceptEula: true }))
    setBusy(false)
    if (r) { notify(r.warnings.length ? `${t('pack.done')} ${r.warnings.length} ${t('mods.warnings')}` : t('pack.done')); onClose(); openServer(r.record.id) }
  }

  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center bg-bg/75 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="pack-title" className="glass flex max-h-[88vh] w-full max-w-xl flex-col rounded-card p-7" initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="pack-title" className="font-display text-[19px] font-semibold">{t('pack.title')}</h2>
          <button onClick={() => !busy && onClose()} aria-label="Schließen" className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted hover:bg-raised hover:text-fg"><X size={16} strokeWidth={1.75} /></button>
        </div>
        <label className="hairline relative mb-3 flex h-10 items-center rounded-ctl bg-raised/60">
          <Search size={14} className="absolute left-3 text-muted" strokeWidth={1.75} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('pack.search')} aria-label={t('pack.search')} className="no-drag h-full w-full select-text bg-transparent pl-9 pr-3 text-[13px] outline-none placeholder:text-muted" />
        </label>
        <ul className="mb-3 min-h-[120px] flex-1 divide-y divide-line/[0.08] overflow-y-auto">
          {hits.map((h) => (
            <li key={h.id}>
              <button onClick={() => { setSource({ type: 'modrinth', projectId: h.id }); setLabel(h.title); setName((n) => n || h.title) }} aria-pressed={source?.type === 'modrinth' && source.projectId === h.id} className={clsx('no-drag flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-raised/40', source?.type === 'modrinth' && source.projectId === h.id && 'bg-accent/5')}>
                {h.iconUrl ? <img src={h.iconUrl} alt="" className="h-9 w-9 rounded-ctl object-cover" /> : <div className="h-9 w-9 rounded-ctl bg-raised" />}
                <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{h.title}</div><div className="line-clamp-1 text-[12px] text-muted">{h.description}</div></div>
                {source?.type === 'modrinth' && source.projectId === h.id && <Check size={16} className="text-accent" />}
              </button>
            </li>
          ))}
        </ul>
        <label className="hairline mb-4 flex cursor-pointer items-center gap-3 rounded-ctl bg-raised/40 p-3 transition-colors hover:bg-raised">
          <FileArchive size={18} strokeWidth={1.5} className="text-accent" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{source?.type === 'file' ? source.path : t('pack.file')}</span>
          <input type="file" accept=".mrpack,.zip" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; const path = f && pathForFile(f); if (f && path) { setSource({ type: 'file', path }); setLabel(f.name); setName((n) => n || f.name.replace(/\.(mrpack|zip)$/i, '')) } }} />
        </label>
        {source && (
          <div className="space-y-3">
            <div className="text-[12.5px] text-muted">{t('pack.chosen')}: <span className="text-fg">{label}</span></div>
            <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('pack.name')}</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={field} /></label>
            <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('pack.ram')}: <span className="font-mono text-fg">{(ram / 1024).toFixed(1)} GB</span></span><input type="range" min={2048} max={32768} step={512} value={ram} onChange={(e) => setRam(Number(e.target.value))} className="no-drag w-full accent-[rgb(var(--accent))]" /></label>
            <label className="flex cursor-pointer items-center gap-3 text-[13.5px]">
              <button type="button" role="checkbox" aria-checked={eula} onClick={() => setEula(!eula)} className={clsx('no-drag grid h-5 w-5 shrink-0 place-items-center rounded-[6px] transition-colors', eula ? 'bg-accent text-accent-fg' : 'hairline bg-raised')}>{eula && <Check size={13} strokeWidth={3} />}</button>
              {t('pack.eula')} <button type="button" onClick={() => invoke('shell.openExternal', 'https://aka.ms/MinecraftEULA')} className="no-drag text-accent underline underline-offset-2">EULA</button>
            </label>
            {busy && <div role="status" className="text-[13px] text-muted">{p?.label ?? '…'}{p?.percent != null ? ` ${p.percent} %` : ''}</div>}
            <div className="flex justify-end"><Button disabled={!eula || !name.trim() || busy} onClick={go}>{t('pack.install')}</Button></div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
