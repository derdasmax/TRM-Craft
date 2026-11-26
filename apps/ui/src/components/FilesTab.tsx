import { ChevronRight, FileText, Folder, FolderPlus, Trash2, Upload, Pencil, PackageOpen, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { FileEntry, ServerView } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke, pathForFile } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const CodeEditor = lazy(() => import('./CodeEditor'))
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export function FilesTab({ server }: { server: ServerView }) {
  const t = useT()
  const notify = useStore((s) => s.notify)
  const dark = document.documentElement.dataset.theme !== 'light'
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [open, setOpen] = useState<{ file: string; text: string; saved: string } | null>(null)
  const [drag, setDrag] = useState(false)
  const join = (n: string) => (path ? `${path}/${n}` : n)

  const load = useCallback(async () => setEntries((await act(() => invoke('files.list', { id: server.id, path }))) ?? []), [server.id, path])
  useEffect(() => { void load() }, [load])

  const openFile = async (name: string) => {
    const f = join(name)
    const r = await act(() => invoke('files.read', { id: server.id, path: f }))
    if (r) setOpen({ file: f, text: r.content, saved: r.content })
  }
  const save = async () => {
    if (!open) return
    const ok = await act(async () => { await invoke('files.write', { id: server.id, path: open.file, content: open.text }); return true })
    if (ok) { setOpen({ ...open, saved: open.text }); notify(t('fi.saved')) }
  }
  const upload = async (paths: string[]) => {
    const n = await act(() => invoke('files.upload', { id: server.id, dir: path, paths }))
    if (n !== undefined) { notify(t('fi.uploaded', { n })); void load() }
  }
  const crumbs = path ? path.split('/') : []

  if (open) {
    const dirty = open.text !== open.saved
    return (
      <div className="flex h-full min-h-[420px] flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate font-mono text-[13px]">{open.file}{dirty && <span className="ml-2 text-warn">● {t('fi.unsaved')}</span>}</div>
          <div className="flex gap-2">
            <Button disabled={!dirty} onClick={save}>{t('fi.save')}</Button>
            <Button variant="ghost" onClick={() => { if (!dirty || window.confirm(t('fi.unsaved') + '. ' + t('fi.close') + '?')) setOpen(null) }}><X size={14} />{t('fi.close')}</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="text-[13px] text-muted">…</div>}>
            <CodeEditor key={open.file} name={open.file} value={open.text} dark={dark} onChange={(v) => setOpen((o) => (o ? { ...o, text: v } : o))} onSave={save} />
          </Suspense>
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx('rounded-card transition-colors', drag && 'bg-accent/5 ring-2 ring-accent/60')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const p = [...e.dataTransfer.files].map((f) => pathForFile(f)).filter((x): x is string => !!x); if (p.length) void upload(p) }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex min-w-0 items-center gap-1 text-[13px]" aria-label="Pfad">
          <button onClick={() => setPath('')} className="no-drag font-medium hover:text-accent">{t('fi.root')}</button>
          {crumbs.map((c, i) => (<span key={i} className="flex items-center gap-1"><ChevronRight size={13} className="text-muted" /><button onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))} className="no-drag hover:text-accent">{c}</button></span>))}
        </nav>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={async () => { const n = window.prompt(t('fi.folderName')); if (n) { await act(() => invoke('files.mkdir', { id: server.id, path: join(n) })); void load() } }}><FolderPlus size={14} />{t('fi.newFolder')}</Button>
          <Button variant="ghost" onClick={async () => { const p = await invoke('dialog.open', {}); if (p) void upload([p]) }}><Upload size={14} />{t('fi.upload')}</Button>
        </div>
      </div>
      {entries.length === 0 ? <div className="pixel-grid hairline rounded-card px-6 py-10 text-center text-[13px] text-muted">{t('fi.empty')}</div> : (
        <ul className="divide-y divide-line/[0.08]">
          {entries.map((e) => (
            <li key={e.name} className="group flex items-center gap-3 py-2">
              <button onClick={() => (e.dir ? setPath(join(e.name)) : openFile(e.name))} className="no-drag flex min-w-0 flex-1 items-center gap-3 text-left">
                {e.dir ? <Folder size={17} strokeWidth={1.5} className="shrink-0 text-accent" /> : <FileText size={17} strokeWidth={1.5} className="shrink-0 text-muted" />}
                <span className="truncate text-[13.5px]">{e.name}</span>
              </button>
              <span className="w-20 text-right font-mono text-[12px] tabular-nums text-muted">{e.dir ? '' : size(e.size)}</span>
              <div className="flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {!e.dir && /\.zip$/i.test(e.name) && <button aria-label={t('fi.unzip')} title={t('fi.unzip')} onClick={async () => { await act(() => invoke('files.unzip', { id: server.id, path: join(e.name) })); void load() }} className="no-drag grid h-7 w-7 place-items-center rounded-ctl text-muted hover:bg-raised hover:text-fg"><PackageOpen size={14} /></button>}
                <button aria-label={t('fi.rename')} title={t('fi.rename')} onClick={async () => { const n = window.prompt(t('fi.rename.to'), e.name); if (n && n !== e.name) { await act(() => invoke('files.rename', { id: server.id, from: join(e.name), to: join(n) })); void load() } }} className="no-drag grid h-7 w-7 place-items-center rounded-ctl text-muted hover:bg-raised hover:text-fg"><Pencil size={14} /></button>
                <button aria-label={t('fi.delete')} title={t('fi.delete')} onClick={async () => { if (window.confirm(t('fi.delete.confirm', { n: e.name }))) { await act(() => invoke('files.delete', { id: server.id, path: join(e.name) })); void load() } }} className="no-drag grid h-7 w-7 place-items-center rounded-ctl text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
