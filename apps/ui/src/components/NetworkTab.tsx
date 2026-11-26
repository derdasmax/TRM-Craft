import { AnimatePresence } from 'framer-motion'
import { BookOpen, Copy, Globe, Network, Radar, ShieldCheck, Waypoints } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { DomainConfig, FirewallStatus, JoinInfo, NetInfo, ReachResult, ServerView, UpnpStatus } from '@trm/core'
import { PortGuide } from './PortGuide'
import { QrCode } from './QrCode'
import { Button, Switch } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT, type Key } from '../lib/i18n'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50'
const Card = ({ icon: I, title, children }: { icon: typeof Globe; title: string; children: React.ReactNode }) => (
  <section className="glass rounded-card p-5"><h3 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold"><I size={16} strokeWidth={1.75} className="text-accent" />{title}</h3>{children}</section>
)

export function NetworkTab({ server }: { server: ServerView }) {
  const t = useT()
  const notify = useStore((s) => s.notify)
  const tunnel = useStore((s) => s.tunnel)
  const [info, setInfo] = useState<NetInfo | null>(null)
  const [join, setJoin] = useState<JoinInfo>({})
  const [domain, setDomain] = useState<DomainConfig | null>(null)
  const [upnp, setUpnp] = useState<UpnpStatus | null>(null)
  const [fw, setFw] = useState<FirewallStatus | null>(null)
  const [reach, setReach] = useState<ReachResult[] | null>(null)
  const [guide, setGuide] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [dom, setDom] = useState({ domain: '', sub: 'play', srv: true })
  const [hasToken, setHasToken] = useState(false)
  const [token, setToken] = useState('')

  const loadAll = useCallback(async () => {
    setInfo((await act(() => invoke('net.info'))) ?? null)
    setJoin((await act(() => invoke('net.join', server.id))) ?? {})
    setDomain(await invoke('net.domain.get', server.id).catch(() => null))
    setFw((await act(() => invoke('net.firewall.status', server.id))) ?? null)
    setHasToken(await invoke('secrets.has', 'cloudflare').catch(() => false))
  }, [server.id])
  useEffect(() => { void loadAll() }, [loadAll])
  useEffect(() => { invoke('net.upnp.status').then(setUpnp).catch(() => setUpnp({ available: false, mapped: [] })) }, [])

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    const ok = await act(async () => { await fn(); return true })
    setBusy(null)
    if (ok && done) notify(done)
    void loadAll()
    return ok
  }
  const copy = (text: string) => { void navigator.clipboard.writeText(text); notify(t('net.copied')) }
  const ports = [{ port: server.port, protocol: server.edition === 'bedrock' ? 'UDP' : 'TCP' }, ...(server.bedrockPort ? [{ port: server.bedrockPort, protocol: 'UDP' }] : [])]
  const qrText = join.java?.address ?? (join.bedrock ? `${join.bedrock.address}:${join.bedrock.port}` : '')
  const mine = upnp?.mapped.some((m) => m.port === server.port)

  const Addr = ({ label, address, port, note }: { label: string; address: string; port?: number; note?: string }) => (
    <div className="flex items-center gap-3 rounded-ctl bg-raised/50 px-4 py-3">
      <div className="min-w-0 flex-1"><div className="text-[12px] text-muted">{label}</div><div className="select-text truncate font-mono text-[15px]">{address}{port ? <span className="text-muted"> · {t('net.join.port')} {port} {t('net.join.udp')}</span> : null}</div>{note && <div className="text-[12px] text-muted">{note}</div>}</div>
      <Button variant="ghost" aria-label={t('net.copy')} onClick={() => copy(port ? `${address}:${port}` : address)}><Copy size={14} />{t('net.copy')}</Button>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><Card icon={Globe} title={t('net.join')}>
        {!join.java && !join.bedrock ? <p className="text-[13px] text-muted">{t('net.join.none')}</p> : (
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[260px] flex-1 space-y-2.5">
              {join.java && <Addr label={t('net.join.java')} address={join.java.address} note={join.java.note ?? (domain?.srv ? t('net.join.note.srv') : undefined)} />}
              {join.bedrock && <Addr label={t('net.join.bedrock')} address={join.bedrock.address} port={join.bedrock.port} note={server.edition === 'java' ? t('net.join.note.bedrock') : undefined} />}
            </div>
            {qrText && <QrCode text={qrText} />}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[12px] text-muted"><span>{t('net.public')}: {info?.publicIp ?? t('net.unknown')}</span><span>{t('net.local')}: {info?.localIps[0] ?? t('net.unknown')}</span></div>
      </Card></div>

      <Card icon={Radar} title={t('net.reach')}>
        <div className="flex items-center gap-3"><Button disabled={busy === 'reach' || server.status !== 'running'} onClick={async () => { setBusy('reach'); const r = await act(() => invoke('net.reach', server.id)); setBusy(null); if (r) setReach(r) }}>{t('net.reach.check')}</Button></div>
        <p className="mt-2 text-[12px] text-muted">{t('net.reach.privacy')}</p>
        {reach?.map((r) => <div key={r.address} role="status" className={clsx('mt-3 rounded-ctl px-3 py-2 text-[13px]', r.online ? 'bg-accent/10 text-accent' : 'bg-danger/10')}><span className="font-mono">{r.address}</span>: {r.online ? t('net.reach.ok') : r.hint}</div>)}
      </Card>

      <Card icon={Waypoints} title={t('net.upnp')}>
        <p className="mb-3 text-[13px] text-muted">{upnp === null ? '…' : upnp.available ? t('net.upnp.found') : t('net.upnp.none')}</p>
        <div className="flex flex-wrap gap-2">
          {mine ? <Button variant="ghost" disabled={!!busy} onClick={() => run('uc', async () => { await invoke('net.upnp.close', server.id); setUpnp(await invoke('net.upnp.status')) }, t('net.upnp.closed'))}>{t('net.upnp.close')}</Button>
            : <Button disabled={!!busy || upnp?.available === false} onClick={() => run('uo', async () => { await invoke('net.upnp.open', server.id); setUpnp(await invoke('net.upnp.status')) }, t('net.upnp.opened'))}>{t('net.upnp.open')}</Button>}
          <Button variant="ghost" onClick={() => setGuide(true)}><BookOpen size={14} />{t('net.guide')}</Button>
        </div>
        <ul className="mt-3 font-mono text-[12px] text-muted">{ports.map((p) => <li key={p.port}>{p.protocol} {p.port}</li>)}</ul>
      </Card>

      <Card icon={ShieldCheck} title={t('net.fw')}>
        {fw && !fw.supported ? <p className="text-[13px] text-muted">{t('net.fw.unsupported')}</p> : <>
          <ul className="mb-3 space-y-1 font-mono text-[12.5px]">{fw?.rules.map((r) => <li key={`${r.protocol}${r.port}`} className="flex justify-between"><span>{r.protocol} {r.port}</span><span className={r.present ? 'text-accent' : 'text-warn'}>{r.present ? t('net.fw.present') : t('net.fw.missing')}</span></li>)}</ul>
          <div className="flex flex-wrap gap-2"><Button disabled={!!busy} onClick={() => run('fa', () => invoke('net.firewall.add', server.id), t('net.fw.done'))}>{t('net.fw.add')}</Button><Button variant="ghost" disabled={!!busy} onClick={() => run('fr', () => invoke('net.firewall.remove', server.id), t('net.fw.done'))}>{t('net.fw.remove')}</Button></div>
          <p className="mt-2 text-[12px] text-muted">{t('net.fw.admin')}</p></>}
      </Card>

      <Card icon={Network} title={t('net.dom')}>
        {!hasToken ? (
          <div className="space-y-2"><p className="text-[12.5px] text-muted">{t('net.dom.token.hint')}</p>
            <div className="flex gap-2"><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-label={t('net.dom.token')} placeholder={t('net.dom.token')} className={clsx(field, 'flex-1 font-mono')} />
              <Button disabled={!token.trim()} onClick={async () => { if (await act(async () => { await invoke('secrets.set', { name: 'cloudflare', value: token }); return true })) { setToken(''); setHasToken(true) } }}>{t('int.save')}</Button></div></div>
        ) : domain ? (
          <div className="space-y-3"><p className="text-[13px]">{t('net.dom.active', { h: domain.host, ip: domain.lastIp ?? '?' })}</p><p className="text-[12px] text-muted">{t('net.dom.ddns')}</p><Button variant="ghost" disabled={!!busy} onClick={() => run('dr', () => invoke('net.domain.remove', server.id))}>{t('net.dom.remove')}</Button></div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2"><input value={dom.domain} onChange={(e) => setDom({ ...dom, domain: e.target.value })} placeholder="meinname.net" aria-label={t('net.dom.domain')} className={field} /><input value={dom.sub} onChange={(e) => setDom({ ...dom, sub: e.target.value })} placeholder="play" aria-label={t('net.dom.sub')} className={clsx(field, 'w-28')} /></div>
            {server.edition === 'java' && <label className="flex items-center justify-between gap-3 text-[13px]">{t('net.dom.srv')}<Switch label={t('net.dom.srv')} checked={dom.srv} onChange={(srv) => setDom({ ...dom, srv })} /></label>}
            <div className="flex gap-2"><Button disabled={!!busy || !dom.domain.trim()} onClick={() => run('ds', () => invoke('net.domain.set', { id: server.id, domain: dom.domain, sub: dom.sub, srv: server.edition === 'java' && dom.srv }), t('net.dom.done'))}>{t('net.dom.setup')}</Button>
              <Button variant="ghost" onClick={async () => { const r = await invoke('net.cf.verify'); notify(r.ok ? t('net.dom.verified') : (r.message ?? '')) }}>{t('net.dom.verify')}</Button></div>
          </div>
        )}
      </Card>

      <Card icon={Waypoints} title={t('net.tun')}>
        <p className="mb-3 text-[12.5px] text-muted">{t('net.tun.hint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {tunnel.status === 'stopped' || tunnel.status === 'error' ? <Button onClick={() => act(() => invoke('net.tunnel.start'))}>{t('net.tun.start')}</Button> : <Button variant="ghost" onClick={() => act(() => invoke('net.tunnel.stop'))}>{t('net.tun.stop')}</Button>}
          <span className="text-[12.5px] text-muted">{t(`net.tun.status.${tunnel.status}` as Key)}</span>
          {tunnel.claimUrl && <Button variant="ghost" onClick={() => invoke('shell.openExternal', tunnel.claimUrl!)}>{t('net.tun.claim')}</Button>}
        </div>
        {tunnel.error && <p className="mt-2 text-[12.5px] text-danger">{tunnel.error}</p>}
        {tunnel.lines.length > 0 && <pre className="mt-3 max-h-32 select-text overflow-auto rounded-ctl bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-muted">{tunnel.lines.slice(-8).join('\n')}</pre>}
      </Card>

      <AnimatePresence>{guide && <PortGuide ports={ports} localIp={info?.localIps[0] ?? '192.168.x.x'} onClose={() => setGuide(false)} />}</AnimatePresence>
    </div>
  )
}
