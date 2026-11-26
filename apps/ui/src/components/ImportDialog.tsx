import { motion } from 'framer-motion'
import { Check, FolderOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { LOADERS, LOADER_INFO, recommendRamMb, type Loader } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-10 w-full select-text rounded-ctl bg-raised/60 px-3.5 text-[13.5px] outline-none focus:border-accent/50'

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const notify = useStore((s) => s.notify)
  const openServer = useStore((s) => s.openServer)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [loader, setLoader] = useState<Loader>('paper')
  const [version, setVersion] = useState('')
  const [versions, setVersions] = useState<string[]>([])
  const [ram, setRam] = useState(4096)
  const [eula, setEula] = useState(false)
  const [busy, setBusy] = useState(false)
  const proxy = LOADER_INFO[loader].proxy

  useEffect(() => { invoke('system.memory').then((m) => setRam(recommendRamMb(m.totalMb))) }, [])
  useEffect(() => { setVersions([]); invoke('versions.list', loader).then((v) => setVersions(v.map((x) => x.id))).catch(() => {}) }, [loader])

  const go = async () => {
    setBusy(true)
    const r = await act(() => invoke('servers.import', { path, name: name.trim(), loader, mcVersion: version.trim(), ramMb: ram, acceptEula: true }))
    setBusy(false)
    if (r) { notify(t('im.done')); onClose(); openServer(r.id) }
  }
  const valid = !!path && !!name.trim() && !!version.trim() && (proxy || eula)

  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center bg-bg/75 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="imp-title" className="glass w-full max-w-lg rounded-card p-7" initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="imp-title" className="font-display text-[19px] font-semibold">{t('im.title')}</h2>
          <button onClick={() => !busy && onClose()} aria-label={t('fi.close')} className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted hover:bg-raised hover:text-fg"><X size={16} strokeWidth={1.75} /></button>
        </div>
        <p className="mb-4 text-[12.5px] text-muted">{t('im.hint')}</p>
        <div className="space-y-3">
          <button onClick={async () => { const p = await invoke('dialog.folder'); if (p) { setPath(p); setName((n) => n || p.split(/[\\/]/).filter(Boolean).pop() || '') } }} className="no-drag hairline flex w-full items-center gap-3 rounded-ctl bg-raised/40 p-3 text-left transition-colors hover:bg-raised">
            <FolderOpen size={18} strokeWidth={1.5} className="text-accent" /><span className="min-w-0 flex-1 truncate text-[13px]">{path || t('im.pick')}</span>
          </button>
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.name')}</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={field} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('im.loader')}</span>
              <select value={loader} onChange={(e) => setLoader(e.target.value as Loader)} className={field}>{LOADERS.filter((l) => LOADER_INFO[l].edition === 'java').map((l) => <option key={l} value={l}>{LOADER_INFO[l].label}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('im.version')}</span>
              <input list="imp-versions" value={version} onChange={(e) => setVersion(e.target.value)} className={clsx(field, 'font-mono')} /><datalist id="imp-versions">{versions.slice(0, 60).map((v) => <option key={v} value={v} />)}</datalist></label>
          </div>
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.ram')}: <span className="font-mono text-fg">{(ram / 1024).toFixed(1)} GB</span></span><input type="range" min={1024} max={32768} step={512} value={ram} onChange={(e) => setRam(Number(e.target.value))} className="no-drag w-full accent-[rgb(var(--accent))]" /></label>
          {!proxy && (
            <label className="flex cursor-pointer items-center gap-3 text-[13.5px]">
              <button type="button" role="checkbox" aria-checked={eula} onClick={() => setEula(!eula)} className={clsx('no-drag grid h-5 w-5 shrink-0 place-items-center rounded-[6px] transition-colors', eula ? 'bg-accent text-accent-fg' : 'hairline bg-raised')}>{eula && <Check size={13} strokeWidth={3} />}</button>
              {t('wiz.eula')} <button type="button" onClick={() => invoke('shell.openExternal', 'https://aka.ms/MinecraftEULA')} className="no-drag text-accent underline underline-offset-2">{t('wiz.eula.link')}</button>
            </label>
          )}
        </div>
        <div className="mt-6 flex justify-end"><Button disabled={!valid || busy} onClick={go}>{busy ? '…' : t('im.go')}</Button></div>
      </motion.div>
    </motion.div>
  )
}
