import { motion } from 'framer-motion'
import { ArrowLeft, Trash2, TriangleAlert } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import clsx from 'clsx'
import { extensionKind, type ServerView } from '@trm/core'
import { Console } from '../components/Console'
import { IconRow, LimitsSection, NotifySection, PropertiesForm, SoftwareSection } from '../components/ServerExtras'
import { LOADER_INFO } from '@trm/core'
import { supportsMods } from '../lib/ext'
import { lazyNamed } from '../lib/lazy'
const BackupsTab = lazyNamed(() => import('../components/BackupsTab'), 'BackupsTab')
const FilesTab = lazyNamed(() => import('../components/FilesTab'), 'FilesTab')
const NetworkTab = lazyNamed(() => import('../components/NetworkTab'), 'NetworkTab')
const PerfTab = lazyNamed(() => import('../components/PerfTab'), 'PerfTab')
const PlayersTab = lazyNamed(() => import('../components/PlayersTab'), 'PlayersTab')
const SchedulesTab = lazyNamed(() => import('../components/SchedulesTab'), 'SchedulesTab')
const WorldsTab = lazyNamed(() => import('../components/WorldsTab'), 'WorldsTab')
const ModsTab = lazyNamed(() => import('../components/ModsTab'), 'ModsTab')
import { ServerActions } from '../components/ServerActions'
import { StatusPill } from '../components/StatusPill'
import { Button, Row, Section, Segmented, Switch } from '../components/ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

function SettingsTab({ s }: { s: ServerView }) {
  const t = useT()
  const notify = useStore((x) => x.notify)
  const setPage = useStore((x) => x.setPage)
  const [name, setName] = useState(s.name)
  const [ram, setRam] = useState(s.ramMb)
  const [port, setPort] = useState(s.port)
  const dirty = name !== s.name || ram !== s.ramMb || port !== s.port
  const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50'
  const save = async () => {
    const ok = await act(() => invoke('servers.update', { id: s.id, patch: { name: name.trim() || s.name, ramMb: ram, port } }))
    if (ok) notify(t('srv.saved'))
  }
  return (
    <div className="max-w-2xl">
      <Section title={t('srv.tab.settings')}>
        <Row title={t('srv.name')}><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={clsx(field, 'w-56')} aria-label={t('srv.name')} /></Row>
        <Row title={t('srv.port')}><input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} className={clsx(field, 'w-28 font-mono tabular-nums')} aria-label={t('srv.port')} /></Row>
        {s.bedrockPort && <Row title={t('srv.bedrockPort')}><span className="font-mono text-[13px] tabular-nums text-muted">{s.bedrockPort}</span></Row>}
        {s.edition === 'java' && <Row title={t('srv.ram')} hint={t('srv.restartHint')}>
          <label className="flex items-center gap-3 text-[13px] text-muted">
            <input type="range" min={1024} max={Math.max(ram, 16384)} step={512} value={ram} onChange={(e) => setRam(Number(e.target.value))} className="no-drag w-40 accent-[rgb(var(--accent))]" aria-label={t('srv.ram')} />
            <span className="w-14 font-mono tabular-nums text-fg">{(ram / 1024).toFixed(1)} GB</span>
          </label>
        </Row>}
        {s.edition === 'java' && <Row title={t('srv.preset')}>
          <Segmented id="preset" value={s.jvmPreset} onChange={(jvmPreset) => act(() => invoke('servers.update', { id: s.id, patch: { jvmPreset } }))} options={[{ value: 'aikar', label: t('srv.preset.aikar') }, { value: 'none', label: t('srv.preset.none') }]} />
        </Row>}
        <Row title={t('srv.autorestart')}><Switch label={t('srv.autorestart')} checked={s.autoRestart} onChange={(autoRestart) => act(() => invoke('servers.update', { id: s.id, patch: { autoRestart } }))} /></Row>
        <Row title={t('srv.autostart')}><Switch label={t('srv.autostart')} checked={s.autostart} onChange={(autostart) => act(() => invoke('servers.update', { id: s.id, patch: { autostart } }))} /></Row>
      </Section>
      <SoftwareSection s={s} />
      <LimitsSection s={s} />
      {LOADER_INFO[s.loader].edition === 'java' && !LOADER_INFO[s.loader].proxy && <Section title={t('ss.icon')}><IconRow s={s} /></Section>}
      {!LOADER_INFO[s.loader].proxy && <PropertiesForm s={s} />}
      <NotifySection s={s} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
        <Button variant="ghost" disabled={s.status !== 'stopped' && s.status !== 'crashed'} onClick={async () => {
          const n = window.prompt(t('cl.name'), `${s.name} (Kopie)`)
          if (!n) return
          const c = await act(() => invoke('servers.clone', { id: s.id, name: n }))
          if (c) { notify(t('cl.done')); useStore.getState().openServer(c.id) }
        }}>{t('cl.clone')}</Button>
        <Button variant="ghost" onClick={async () => {
          if (!window.confirm(t('srv.delete.confirm', { n: s.name }))) return
          if ((await act(async () => { await invoke('servers.delete', s.id); return true })) ) setPage('dashboard')
        }} className="text-danger"><Trash2 size={14} strokeWidth={1.75} />{t('srv.delete')}</Button>
        </div>
        <Button onClick={save} disabled={!dirty}>{t('srv.save')}</Button>
      </div>
    </div>
  )
}

export function ServerPage() {
  const t = useT()
  const id = useStore((s) => s.selected)
  const s = useStore((x) => (id ? x.servers[id] : undefined))
  const setPage = useStore((x) => x.setPage)
  const tab = useStore((x) => x.serverTab)
  const setTab = useStore((x) => x.setServerTab)
  useEffect(() => { if (!s) setPage('dashboard') }, [s, setPage])
  if (!s) return null
  return (
    <div className="flex h-full flex-col p-8">
      <button onClick={() => setPage('dashboard')} className="no-drag mb-4 inline-flex w-fit items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-fg"><ArrowLeft size={14} strokeWidth={1.75} />{t('srv.back')}</button>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[24px] font-semibold tracking-tight">{s.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3"><StatusPill status={s.status} /><span className="font-mono text-[12px] text-muted">{s.loader} {s.mcVersion} · :{s.port}{s.edition === 'bedrock' ? ' UDP' : ''}{s.bedrockPort ? ` · :${s.bedrockPort} UDP` : ''}</span>{s.players.length > 0 && <span className="text-[12.5px] text-muted">{s.players.join(', ')}</span>}</div>
        </div>
        <ServerActions s={s} />
      </div>
      {s.status === 'crashed' && s.lastCrash && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 flex gap-3 rounded-card bg-danger/10 p-4 text-[13px]" role="alert">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" strokeWidth={1.75} />
          <div><div className="font-semibold text-danger">{t('srv.crash')}</div><div className="mt-0.5">{s.lastCrash.message}</div>{s.lastCrash.hint && <div className="mt-0.5 text-muted">{s.lastCrash.hint}</div>}</div>
        </motion.div>
      )}
      <div className="mb-4 max-w-full overflow-x-auto pb-1">
        <Segmented id="srvtab" value={tab} onChange={setTab} options={[
          { value: 'console' as const, label: t('srv.tab.console') },
          ...(!LOADER_INFO[s.loader].proxy ? [{ value: 'players' as const, label: t('tab.players') }] : []),
          { value: 'files' as const, label: t('tab.files') },
          ...(!LOADER_INFO[s.loader].proxy ? [{ value: 'worlds' as const, label: t('tab.worlds') }] : []),
          { value: 'backups' as const, label: t('tab.backups') },
          { value: 'schedules' as const, label: t('tab.schedules') },
          { value: 'perf' as const, label: t('tab.perf') },
          { value: 'network' as const, label: t('tab.network') },
          ...(supportsMods(s) ? [{ value: 'mods' as const, label: t(extensionKind(s.loader) === 'plugin' ? 'mods.tab.plugin' : 'mods.tab.mod') }] : []),
          { value: 'settings' as const, label: t('srv.tab.settings') },
        ]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto"><Suspense fallback={null}>{tab === 'console' ? <Console server={s} />
          : tab === 'players' ? <PlayersTab key={s.id} server={s} />
          : tab === 'files' ? <FilesTab key={s.id} server={s} />
          : tab === 'worlds' ? <WorldsTab key={s.id} server={s} />
          : tab === 'backups' ? <BackupsTab key={s.id} server={s} />
          : tab === 'schedules' ? <SchedulesTab key={s.id} server={s} />
          : tab === 'perf' ? <PerfTab key={s.id} server={s} />
          : tab === 'network' ? <NetworkTab key={s.id} server={s} />
          : tab === 'mods' ? <ModsTab key={s.id} server={s} /> : <SettingsTab key={s.id} s={s} />}</Suspense></div>
    </div>
  )
}
