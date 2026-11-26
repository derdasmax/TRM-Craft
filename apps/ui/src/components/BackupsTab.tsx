import { Archive, FolderOpen, History, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, ServerView } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const size = (n: number) => (n > 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`)

export function BackupsTab({ server }: { server: ServerView }) {
  const t = useT()
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const stopped = server.status === 'stopped' || server.status === 'crashed'
  const load = useCallback(async () => setList((await act(() => invoke('backups.list', server.id))) ?? []), [server.id])
  useEffect(() => { void load() }, [load])
  const patch = (backup: ServerView['backup']) => act(() => invoke('servers.update', { id: server.id, patch: { backup } }))

  return (
    <div className="space-y-8">
      <section className="glass grid gap-4 rounded-card p-5 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('bk.keep')}</span>
          <input type="number" min={1} max={200} value={server.backup.keep} onChange={(e) => { const n = Math.max(1, Math.min(200, Number(e.target.value) || 1)); void patch({ ...server.backup, keep: n }) }} className="no-drag hairline h-9 w-28 select-text rounded-ctl bg-raised/60 px-3 font-mono text-[13px] tabular-nums outline-none focus:border-accent/50" /></label>
        <div><span className="mb-1.5 block text-[12.5px] text-muted">{t('bk.dir')}</span>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{server.backup.dir ?? t('bk.dir.default')}</span>
            <Button variant="ghost" onClick={async () => { const d = await invoke('dialog.folder'); if (d) { await patch({ ...server.backup, dir: d }); void load() } }}><FolderOpen size={14} />{t('bk.dir.pick')}</Button>
            {server.backup.dir && <Button variant="ghost" onClick={async () => { await patch({ keep: server.backup.keep }); void load() }}>{t('bk.dir.reset')}</Button>}
          </div></div>
      </section>

      <section>
        <div className="mb-3 flex justify-end">
          <Button disabled={busy} onClick={async () => { setBusy(true); const r = await act(() => invoke('backups.create', { id: server.id })); setBusy(false); if (r) { notify(t('bk.done')); void load() } }}><Archive size={14} />{busy ? t('bk.running') : t('bk.create')}</Button>
        </div>
        {list.length === 0 ? <div className="pixel-grid hairline rounded-card px-6 py-10 text-center text-[13px] text-muted">{t('bk.empty')}</div> : (
          <ul className="divide-y divide-line/[0.08]">
            {list.map((b) => (
              <li key={b.file} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{new Date(b.created).toLocaleString()}{b.label && <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">{b.label}</span>}</div><div className="font-mono text-[12px] text-muted">{b.file} · {size(b.size)}</div></div>
                <Button variant="ghost" disabled={!stopped} title={stopped ? undefined : t('wo.stopFirst')} onClick={async () => { if (!window.confirm(t('bk.restore.confirm', { n: b.file }))) return; setBusy(true); const ok = await act(async () => { await invoke('backups.restore', { id: server.id, file: b.file }); return true }); setBusy(false); if (ok) { notify(t('bk.restored')); void load() } }}><History size={14} />{t('bk.restore')}</Button>
                <button aria-label={t('bk.delete')} title={t('bk.delete')} onClick={async () => { await act(() => invoke('backups.delete', { id: server.id, file: b.file })); void load() }} className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
