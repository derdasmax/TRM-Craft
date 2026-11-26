import { Download, Map as MapIcon, RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ServerView, WorldInfo } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const gb = (n: number) => (n > 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`)

export function WorldsTab({ server }: { server: ServerView }) {
  const t = useT()
  const notify = useStore((s) => s.notify)
  const [worlds, setWorlds] = useState<WorldInfo[]>([])
  const stopped = server.status === 'stopped' || server.status === 'crashed'
  const load = useCallback(async () => setWorlds((await act(() => invoke('worlds.list', server.id))) ?? []), [server.id])
  useEffect(() => { void load() }, [load])
  const done = async (fn: () => Promise<unknown>, msg = t('wo.done')) => { if ((await act(async () => { await fn(); return true })) ) { notify(msg); void load() } }
  const canMap = ['paper', 'purpur', 'spigot', 'folia', 'fabric', 'forge', 'neoforge', 'quilt'].includes(server.loader)

  return (
    <div className="space-y-8">
      {!stopped && <p className="text-[12.5px] text-warn">{t('wo.stopFirst')}</p>}
      <section>
        <div className="mb-3 flex justify-end">
          <Button variant="ghost" disabled={!stopped} onClick={async () => { const p = await invoke('dialog.open', { filters: [{ name: 'ZIP', extensions: ['zip'] }] }); if (p) void done(() => invoke('worlds.import', { id: server.id, zipPath: p })) }}><Upload size={14} />{t('wo.import')}</Button>
        </div>
        {worlds.length === 0 ? <div className="pixel-grid hairline rounded-card px-6 py-10 text-center text-[13px] text-muted">{t('wo.empty')}</div> : (
          <ul className="divide-y divide-line/[0.08]">
            {worlds.map((w) => (
              <li key={w.name} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-medium">{w.name}{w.active && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">{t('wo.active')}</span>}</div>
                  <div className="font-mono text-[12px] text-muted">{gb(w.sizeBytes)}{w.seed ? ` · ${t('wo.seed')}: ${w.seed}` : ''}</div>
                </div>
                {!w.active && <Button variant="ghost" disabled={!stopped} onClick={() => done(() => invoke('worlds.setActive', { id: server.id, name: w.name }))}>{t('wo.activate')}</Button>}
                <Button variant="ghost" onClick={async () => { const dest = await invoke('dialog.save', { defaultName: `${w.name}.zip` }); if (dest) void done(() => invoke('worlds.export', { id: server.id, name: w.name, dest }), t('wo.exported')) }}><Download size={14} />{t('wo.export')}</Button>
                <Button variant="ghost" disabled={!stopped} className="text-danger" onClick={() => { if (window.confirm(t('wo.reset.confirm', { n: w.name }))) void done(() => invoke('worlds.reset', { id: server.id, name: w.name })) }}><RotateCcw size={14} />{t('wo.reset')}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canMap && (
        <section className="glass flex items-center gap-4 rounded-card p-5">
          <MapIcon size={22} strokeWidth={1.5} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{t('wo.map')}</div><div className="text-[12.5px] text-muted">{t('wo.map.hint')}</div></div>
          <Button onClick={() => void done(() => invoke('mods.install', { id: server.id, source: 'modrinth', projectId: 'dynmap' }), t('mods.done', { n: 1 }))}>{t('wo.map.install')}</Button>
        </section>
      )}
    </div>
  )
}
