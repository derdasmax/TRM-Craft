import clsx from 'clsx'
import { ArrowUpCircle, Download, Search, Trash2, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { extensionKind, type InstalledMod, type ModHit, type ModSource, type ModUpdate, type ServerView } from '@trm/core'
import { Button, Segmented, Switch } from './ui'
import { act } from '../lib/act'
import { invoke, pathForFile } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const HANGAR_LOADERS = ['paper', 'purpur', 'folia', 'spigot', 'velocity', 'waterfall', 'bungeecord']

export function ModsTab({ server }: { server: ServerView }) {
  const t = useT()
  const notify = useStore((s) => s.notify)
  const kind = extensionKind(server.loader) ?? 'mod'
  const [installed, setInstalled] = useState<InstalledMod[]>([])
  const [updates, setUpdates] = useState<ModUpdate[] | null>(null)
  const [source, setSource] = useState<ModSource>('modrinth')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [drag, setDrag] = useState(false)
  const reqId = useRef(0)

  const sources: { value: ModSource; label: string }[] = [
    { value: 'modrinth', label: 'Modrinth' },
    { value: 'curseforge', label: 'CurseForge' },
    ...(HANGAR_LOADERS.includes(server.loader) ? [{ value: 'hangar' as const, label: 'Hangar' }] : []),
  ]

  const refresh = useCallback(async () => setInstalled((await act(() => invoke('mods.installed', server.id))) ?? []), [server.id])
  useEffect(() => { void refresh() }, [refresh])

  const search = useCallback(async (offset: number) => {
    const id = ++reqId.current
    setLoading(true)
    const r = await act(() => invoke('mods.search', { source, serverId: server.id, kind, query, offset }))
    if (id !== reqId.current) return
    setLoading(false)
    if (!r) return setHits([])
    setTotal(r.total)
    setHits((h) => (offset === 0 ? r.hits : [...h, ...r.hits]))
  }, [source, server.id, kind, query])

  // Entprellte Suche
  useEffect(() => {
    const h = setTimeout(() => void search(0), 350)
    return () => clearTimeout(h)
  }, [search])

  const report = (r: { installed: unknown[]; warnings: string[] }) => {
    if (r.installed.length) notify(t('mods.done', { n: r.installed.length }))
    setWarnings(r.warnings)
  }

  const install = async (hit: ModHit) => {
    setBusy(hit.id)
    const r = await act(() => invoke('mods.install', { id: server.id, source: hit.source, projectId: hit.id }))
    setBusy(null)
    if (r) { report(r); void refresh() }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const paths = [...e.dataTransfer.files].map((f) => pathForFile(f)).filter((p): p is string => !!p)
    if (!paths.length) return
    const r = await act(() => invoke('mods.addFiles', { id: server.id, paths }))
    if (r) { report(r); void refresh() }
  }

  const checkUpdates = async () => {
    const u = await act(() => invoke('mods.checkUpdates', server.id))
    if (u) { setUpdates(u); if (!u.length) notify(t('mods.noUpdates')) }
  }
  const doUpdate = async (file: string) => {
    setBusy(file)
    await act(() => invoke('mods.update', { id: server.id, file }))
    setBusy(null)
    setUpdates((u) => u?.filter((x) => x.file !== file) ?? null)
    void refresh()
  }

  const installedIds = new Set(installed.map((i) => i.projectId).filter(Boolean))
  const icon = (url?: string) => url ? <img src={url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-ctl bg-raised object-cover" /> : <div className="h-10 w-10 shrink-0 rounded-ctl bg-raised" />

  return (
    <div
      className={clsx('relative space-y-8 rounded-card transition-colors', drag && 'bg-accent/5 ring-2 ring-accent/60')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={onDrop}
    >
      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-card bg-bg/70 text-[14px] font-medium"><span className="flex items-center gap-2"><UploadCloud size={18} />{t('mods.drop')}</span></div>}

      {warnings.length > 0 && (
        <div role="status" className="rounded-card bg-warn/10 p-4 text-[13px]">
          <div className="mb-1 flex items-center justify-between font-semibold text-warn">{t('mods.warnings')}<button onClick={() => setWarnings([])} className="no-drag text-[12px] font-normal text-muted hover:text-fg">×</button></div>
          <ul className="space-y-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-display text-[15px] font-semibold">{t('mods.installed')} <span className="font-mono text-[12px] text-muted">{installed.length}</span></h3>
          <Button variant="ghost" onClick={checkUpdates}><ArrowUpCircle size={14} strokeWidth={1.75} />{t('mods.updates')}</Button>
        </div>
        {updates && updates.length > 0 && <p className="mb-2 text-[12.5px] text-accent">{t('mods.updateAvail', { n: updates.length })}</p>}
        {installed.length === 0 ? (
          <div className="pixel-grid hairline rounded-card px-6 py-8 text-center text-[13px] text-muted">{t('mods.empty')}</div>
        ) : (
          <ul className="divide-y divide-line/[0.08]">
            {installed.map((m) => {
              const upd = updates?.find((u) => u.file === m.file)
              return (
                <li key={m.file} className={clsx('flex items-center gap-3 py-2.5', !m.enabled && 'opacity-55')}>
                  {icon(m.iconUrl)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{m.title ?? m.file}</div>
                    <div className="truncate font-mono text-[11.5px] text-muted">{m.file}{m.version ? ` · ${m.version}` : ''}</div>
                  </div>
                  {upd && <Button disabled={busy === m.file} onClick={() => doUpdate(m.file)}><ArrowUpCircle size={14} />{t('mods.update')} {upd.to}</Button>}
                  <Switch label={m.enabled ? t('mods.disable') : t('mods.enable')} checked={m.enabled} onChange={async (enabled) => { await act(() => invoke('mods.toggle', { id: server.id, file: m.file, enabled })); void refresh() }} />
                  <button aria-label={t('mods.remove')} title={t('mods.remove')} onClick={async () => { await act(() => invoke('mods.remove', { id: server.id, file: m.file })); void refresh() }} className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted transition-colors hover:bg-danger/10 hover:text-danger"><Trash2 size={15} strokeWidth={1.75} /></button>
                </li>
              )
            })}
          </ul>
        )}
        {server.status !== 'stopped' && installed.length > 0 && <p className="mt-2 text-[12px] text-muted">{t('mods.restartHint')}</p>}
      </section>

      <section>
        <h3 className="mb-3 font-display text-[15px] font-semibold">{t('mods.browse')}</h3>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented id="src" value={source} onChange={(v) => { setSource(v); setHits([]) }} options={sources} />
          <label className="hairline relative flex h-9 min-w-[200px] flex-1 items-center rounded-ctl bg-raised/60">
            <Search size={14} className="absolute left-3 text-muted" strokeWidth={1.75} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('mods.search')} aria-label={t('mods.search')} className="no-drag h-full w-full select-text bg-transparent pl-9 pr-3 text-[13px] outline-none placeholder:text-muted" />
          </label>
        </div>
        {source === 'curseforge' && <p className="mb-2 text-[12px] text-muted">{t('mods.cfKey')}</p>}
        <ul className="divide-y divide-line/[0.08]">
          {hits.map((h) => (
            <li key={`${h.source}:${h.id}`} className="flex items-center gap-3 py-3">
              {icon(h.iconUrl)}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2"><span className="truncate text-[13.5px] font-medium">{h.title}</span>{h.author && <span className="shrink-0 text-[12px] text-muted">{h.author}</span>}</div>
                <p className="line-clamp-1 text-[12.5px] text-muted">{h.description}</p>
                <span className="font-mono text-[11.5px] tabular-nums text-muted">{Intl.NumberFormat('de-DE', { notation: 'compact' }).format(h.downloads)} {t('mods.downloads')}</span>
              </div>
              {installedIds.has(h.id) ? <span className="text-[12.5px] text-accent">{t('mods.installedBadge')}</span> : <Button variant="ghost" disabled={busy === h.id} onClick={() => install(h)}><Download size={14} strokeWidth={1.75} />{busy === h.id ? '…' : t('mods.install')}</Button>}
            </li>
          ))}
        </ul>
        {!loading && hits.length === 0 && <p className="py-6 text-center text-[13px] text-muted">{t('mods.noResults')}</p>}
        {hits.length < total && <div className="mt-3 text-center"><Button variant="ghost" disabled={loading} onClick={() => void search(hits.length)}>{t('mods.more')}</Button></div>}
      </section>
    </div>
  )
}

