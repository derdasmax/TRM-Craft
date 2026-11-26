import { Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import { Button, Row, Section, Segmented, Switch } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT, type Key } from '../lib/i18n'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50'
const mb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const isOrigin = (o: string) => { try { const u = new URL(o); return u.origin === o && (u.protocol === 'https:' || u.hostname === 'localhost') } catch { return false } }

function Dot({ on }: { on: boolean }) { return <span className={clsx('h-2 w-2 rounded-full', on ? 'bg-accent' : 'bg-muted')} aria-hidden /> }

export function RemoteSection() {
  const t = useT()
  const s = useStore((x) => x.settings.remote)
  const update = useStore((x) => x.update)
  const notify = useStore((x) => x.notify)
  const st = useStore((x) => x.remote)
  const uploads = useStore((x) => x.uploads)
  const devices = useStore((x) => x.devices)
  const [origin, setOrigin] = useState('')
  const [domain, setDomain] = useState('')
  const [sub, setSub] = useState('craft')
  const [upload, setUpload] = useState(true)
  const [siteUrl, setSiteUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const tun = st?.tunnel

  const addOrigin = () => {
    const o = origin.trim().replace(/\/$/, '')
    if (!isOrigin(o)) return notify(t('rm.origins.bad'))
    if (!s.allowedOrigins.includes(o)) update({ remote: { allowedOrigins: [...s.allowedOrigins, o] } })
    setOrigin('')
  }
  const status = !s.enabled ? t('rm.status.off') : st?.lastError ?? (st?.listening ? t('rm.status.listening') : t('rm.status.stopped'))

  return (
    <>
      <Section title={t('rm.title')}>
        <Row title={t('rm.enabled')} hint={t('rm.enabled.hint')}><Switch label={t('rm.enabled')} checked={s.enabled} onChange={(enabled) => update({ remote: { enabled } })} /></Row>
        <Row title={t('rm.status')}><span role="status" className={clsx('flex items-center gap-2 text-[13px]', st?.listening ? 'text-accent' : 'text-muted')}><Dot on={!!st?.listening} />{status}</span></Row>
        {st?.publicUrl && <Row title={t('rm.publicUrl')}><span className="select-text font-mono text-[12.5px]">{st.publicUrl}</span></Row>}
        <Row title={t('rm.name')}><input value={s.deviceName} maxLength={60} onChange={(e) => update({ remote: { deviceName: e.target.value } })} className={clsx(field, 'w-48')} aria-label={t('rm.name')} /></Row>
        <Row title={t('rm.mode')}>
          <Segmented id="rmmode" value={s.mode} onChange={(mode) => update({ remote: { mode } })} options={(['tunnel', 'direct'] as const).map((m) => ({ value: m, label: t(`rm.mode.${m}` as Key) }))} />
        </Row>
        <Row title={t('rm.port')}><input type="number" min={1024} max={65535} value={s.port} onChange={(e) => update({ remote: { port: Math.max(1024, Math.min(65535, Number(e.target.value) || 47821)) } })} className={clsx(field, 'w-28 font-mono tabular-nums')} aria-label={t('rm.port')} /></Row>
        <div className="py-3.5">
          <div className="text-[13.5px] font-medium">{t('rm.origins')}</div>
          <div className="mb-2 text-[12px] text-muted">{t('rm.origins.hint')}</div>
          <ul className="mb-2 space-y-1">
            {s.allowedOrigins.map((o) => <li key={o} className="flex items-center justify-between text-[13px]"><span className="select-text font-mono">{o}</span><Button variant="ghost" onClick={() => update({ remote: { allowedOrigins: s.allowedOrigins.filter((x) => x !== o) } })} aria-label={`${o} ${t('rm.devices.revoke')}`}><Trash2 size={14} /></Button></li>)}
          </ul>
          <div className="flex gap-2">
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOrigin()} placeholder="https://trm.deinedomain.de" aria-label={t('rm.origins')} className={clsx(field, 'w-80 font-mono')} />
            <Button variant="ghost" onClick={addOrigin}>{t('rm.origins.add')}</Button>
          </div>
        </div>
        <Row title={t('rm.maxRole')}>
          <Segmented id="maxrole" value={s.maxRole} onChange={(maxRole) => update({ remote: { maxRole } })} options={(['viewer', 'moderator', 'admin'] as const).map((r) => ({ value: r, label: t(`rm.role.${r}` as Key) }))} />
        </Row>
        <Row title={t('rm.limit')}><input type="number" min={1} max={20480} value={s.uploadLimitMb} onChange={(e) => update({ remote: { uploadLimitMb: Math.max(1, Math.min(20480, Number(e.target.value) || 1)) } })} className={clsx(field, 'w-28 font-mono tabular-nums')} aria-label={t('rm.limit')} /></Row>
      </Section>

      {s.mode === 'tunnel' ? (
        <Section title={t('rm.tunnel.title')}>
          <div className="pb-1 pt-3 text-[12px] text-muted">{t('rm.tunnel.hint')}</div>
          {tun?.host ? (
            <>
              <Row title={t('rm.tunnel.addr')}><span className="select-text font-mono text-[12.5px]">{tun.host}</span></Row>
              <Row title={t('rm.status')}><span role="status" className={clsx('flex items-center gap-2 text-[13px]', tun.phase === 'connected' ? 'text-accent' : tun.phase === 'error' ? 'text-danger' : 'text-muted')}><Dot on={tun.phase === 'connected'} />{tun.serviceInstalled ? t('rm.tunnel.svc.on') : t(`rm.tp.${tun.phase}` as Key)}{tun.error ? ` – ${tun.error}` : ''}</span></Row>
              {tun.phase === 'connected' && <Row title={t('rm.tunnel.reach')}><span className={clsx('text-[13px]', tun.reachable ? 'text-accent' : 'text-muted')}>{tun.reachable ? '✓' : t('rm.tunnel.reach.no')}</span></Row>}
              <div className="flex flex-wrap gap-2 py-3.5">
                {!tun.serviceInstalled && (tun.phase === 'connected' || tun.phase === 'starting' || tun.phase === 'downloading'
                  ? <Button variant="ghost" onClick={() => act(() => invoke('remote.tunnel.stop'))}>{t('rm.tunnel.stop')}</Button>
                  : <Button variant="ghost" onClick={() => act(() => invoke('remote.tunnel.start'))}>{t('rm.tunnel.start')}</Button>)}
                <Button variant="ghost" onClick={() => act(() => invoke('remote.tunnel.service', { install: !tun.serviceInstalled }))}>{tun.serviceInstalled ? t('rm.tunnel.svc.remove') : t('rm.tunnel.svc.install')}</Button>
                <Button variant="ghost" onClick={() => act(() => invoke('remote.tunnel.remove'))}>{t('rm.tunnel.remove')}</Button>
              </div>
              {tun.lines.length > 0 && <pre className="mb-3 max-h-32 select-text overflow-auto rounded-ctl bg-raised/50 p-2 font-mono text-[11px] text-muted">{tun.lines.slice(-8).join('\n')}</pre>}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2 py-3.5">
              <input value={sub} onChange={(e) => setSub(e.target.value.toLowerCase())} aria-label={t('rm.tunnel.sub')} className={clsx(field, 'w-32 font-mono')} />
              <span className="text-muted">.</span>
              <input value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase())} placeholder="deinedomain.de" aria-label={t('rm.tunnel.domain')} className={clsx(field, 'w-56 font-mono')} />
              <Button disabled={busy || !domain.trim() || !sub.trim()} onClick={async () => { setBusy(true); try { if (await act(async () => { await invoke('remote.tunnel.setup', { domain: domain.trim(), sub: sub.trim() }); return true })) notify(t('rm.tunnel.done')) } finally { setBusy(false) } }}>{t('rm.tunnel.setup')}</Button>
            </div>
          )}
        </Section>
      ) : (
        <Section title={t('rm.mode.direct')}>
          <div className="pb-1 pt-3 text-[12px] text-muted">{t('rm.direct.hint')}</div>
          <Row title={t('rm.publicHost')}><input value={s.publicHost} onChange={(e) => update({ remote: { publicHost: e.target.value.trim() } })} placeholder="craft.deinedomain.de" className={clsx(field, 'w-64 font-mono')} aria-label={t('rm.publicHost')} /></Row>
          <Row title={t('rm.cert')}><input value={s.tlsCertPath} onChange={(e) => update({ remote: { tlsCertPath: e.target.value } })} className={clsx(field, 'w-80 font-mono')} aria-label={t('rm.cert')} /></Row>
          <Row title={t('rm.key')}><input value={s.tlsKeyPath} onChange={(e) => update({ remote: { tlsKeyPath: e.target.value } })} className={clsx(field, 'w-80 font-mono')} aria-label={t('rm.key')} /></Row>
        </Section>
      )}

      <Section title={t('rm.pair.title')}>
        <Row title={t('rm.pair.upload')}><Switch label={t('rm.pair.upload')} checked={upload} onChange={setUpload} /></Row>
        <Row title={t('rm.pairStart')}>
          {st?.pairing ? (
            <div className="flex items-center gap-3"><span className="text-[12.5px] text-muted">{t('rm.pairing.code')}</span><span className="select-text font-mono text-[18px] tracking-widest">{st.pairing.code}</span><Button variant="ghost" onClick={() => act(() => invoke('remote.pairCancel'))}>{t('rm.pairCancel')}</Button></div>
          ) : <Button variant="ghost" disabled={!s.enabled} onClick={() => act(() => invoke('remote.pairStart', { upload }))}>{t('rm.pairStart')}</Button>}
        </Row>
        <Row title={t('rm.claim.code')} hint={t('rm.claim.hint')}>
          <div className="flex gap-2">
            <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://trm.deinedomain.de" aria-label={t('rm.claim.url')} className={clsx(field, 'w-60 font-mono')} />
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={24} autoComplete="off" aria-label={t('rm.claim.code')} className={clsx(field, 'w-32 font-mono tracking-wider')} />
            <Button disabled={!s.enabled || !code.trim() || !siteUrl.trim()} onClick={async () => { if (await act(async () => { await invoke('remote.claim', { siteUrl: siteUrl.trim().replace(/\/$/, ''), code, upload }); return true })) { setCode(''); notify(t('rm.claim.ok')) } }}>{t('rm.claim.go')}</Button>
          </div>
        </Row>
        <div className="py-3.5">
          <div className="mb-1.5 text-[13.5px] font-medium">{t('rm.devices')}</div>
          {devices.length === 0 ? <div className="text-[12.5px] text-muted">{t('rm.devices.none')}</div> : (
            <ul className="space-y-1.5 text-[13px]">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{d.name} <span className="text-muted">· {d.role}{d.canUpload ? ` · ${t('rm.devices.upload')}` : ''}{d.lastSeen ? ` · ${t('rm.devices.seen', { t: new Date(d.lastSeen).toLocaleString() })}` : ''}</span></span>
                  <Button variant="ghost" onClick={() => act(async () => { await invoke('remote.revoke', d.id) })}>{t('rm.devices.revoke')}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="py-3.5">
          <div className="mb-1.5 text-[13.5px] font-medium">{t('rm.sessions')}</div>
          {!st?.sessions.length ? <div className="text-[12.5px] text-muted">{t('rm.sessions.none')}</div> : <ul className="space-y-1 text-[13px]">{st.sessions.map((x) => <li key={x.id} className="flex justify-between"><span>{x.user} <span className="text-muted">· {x.device}</span></span><span className="text-muted">{x.role}</span></li>)}</ul>}
        </div>
      </Section>

      <Section title={t('rm.uploads')}>
        {uploads.length === 0 ? <div className="py-4 text-[13px] text-muted">{t('rm.uploads.none')}</div> : uploads.slice(0, 30).map((u) => (
          <div key={u.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium">{u.fileName} <span className="font-normal text-muted">→ {u.serverName}</span></div>
              <div className="text-[12px] text-muted">{new Date(u.time).toLocaleString()} · {t('rm.uploads.by', { u: u.uploader })} · {mb(u.size)}{u.kind ? ` · ${u.kind}` : ''}</div>
              {u.status === 'receiving' && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised"><div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(((u.received ?? 0) / u.size) * 100)}%` }} /></div>}
              {u.error && <div className="mt-1 text-[12px] text-danger">{u.error}</div>}
              {u.warnings.map((w, i) => <div key={i} className="mt-1 text-[12px] text-warn">{w}</div>)}
            </div>
            <span className={clsx('text-[12px]', u.status === 'done' ? 'text-accent' : u.status === 'failed' ? 'text-danger' : 'text-muted')}>{t(`rm.us.${u.status}` as Key)}</span>
            {u.undoable && <Button variant="ghost" onClick={() => act(() => invoke('remote.undo', u.id))}><Undo2 size={14} />{t('rm.uploads.undo')}</Button>}
          </div>
        ))}
      </Section>
    </>
  )
}
