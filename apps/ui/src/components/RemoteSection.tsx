import { Undo2 } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import { Button, Row, Section, Segmented, Switch } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT, type Key } from '../lib/i18n'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50'
const mb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function RemoteSection() {
  const t = useT()
  const s = useStore((x) => x.settings.remote)
  const update = useStore((x) => x.update)
  const notify = useStore((x) => x.notify)
  const st = useStore((x) => x.remote)
  const uploads = useStore((x) => x.uploads)
  const [code, setCode] = useState('')
  const [url, setUrl] = useState(s.url)

  const status = !st?.paired ? t('rm.status.unpaired') : !st.enabled ? t('rm.status.off') : st.connected ? t('rm.status.connected', { s: st.siteName ?? '' }) : (st.lastError ?? t('rm.status.disconnected'))

  return (
    <>
      <Section title={t('rm.title')}>
        <Row title={t('rm.url')}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== s.url && update({ remote: { url: url.trim() } })} placeholder="wss://…" aria-label={t('rm.url')} className={clsx(field, 'w-72 font-mono')} />
        </Row>
        <Row title={t('rm.name')}><input value={s.deviceName} maxLength={60} onChange={(e) => update({ remote: { deviceName: e.target.value } })} className={clsx(field, 'w-48')} aria-label={t('rm.name')} /></Row>
        {!st?.paired ? (
          <Row title={t('rm.code')} hint={t('rm.code.hint')}>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={24} autoComplete="off" aria-label={t('rm.code')} className={clsx(field, 'w-40 font-mono tracking-wider')} />
              <Button disabled={!code.trim() || !s.url} onClick={async () => { if (await act(async () => { await invoke('remote.pair', code); return true })) { setCode(''); notify(t('rm.paired')) } }}>{t('rm.pair')}</Button>
            </div>
          </Row>
        ) : (
          <>
            <Row title={t('rm.enabled')} hint={t('rm.enabled.hint')}><Switch label={t('rm.enabled')} checked={s.enabled} onChange={(enabled) => update({ remote: { enabled } })} /></Row>
            <Row title={t('rm.maxRole')}>
              <Segmented id="maxrole" value={s.maxRole} onChange={(maxRole) => update({ remote: { maxRole } })} options={(['viewer', 'moderator', 'admin'] as const).map((r) => ({ value: r, label: t(`rm.role.${r}` as Key) }))} />
            </Row>
            <Row title={t('rm.limit')}><input type="number" min={1} max={20480} value={s.uploadLimitMb} onChange={(e) => update({ remote: { uploadLimitMb: Math.max(1, Math.min(20480, Number(e.target.value) || 1)) } })} className={clsx(field, 'w-28 font-mono tabular-nums')} aria-label={t('rm.limit')} /></Row>
            <Row title={t('rm.upload.perm')}><span className={clsx('text-[12.5px]', st.canUpload ? 'text-accent' : 'text-muted')}>{st.canUpload ? '✓' : '–'}</span></Row>
            <Row title={t('rm.unpair')}><Button variant="ghost" onClick={() => act(() => invoke('remote.unpair'))}>{t('rm.unpair')}</Button></Row>
          </>
        )}
        <Row title="Status"><span role="status" className={clsx('flex items-center gap-2 text-[13px]', st?.connected ? 'text-accent' : 'text-muted')}><span className={clsx('h-2 w-2 rounded-full', st?.connected ? 'bg-accent' : 'bg-muted')} aria-hidden />{status}</span></Row>
        {st?.paired && (
          <div className="py-3.5">
            <div className="mb-1.5 text-[13.5px] font-medium">{t('rm.sessions')}</div>
            {st.sessions.length === 0 ? <div className="text-[12.5px] text-muted">{t('rm.sessions.none')}</div> : <ul className="space-y-1 text-[13px]">{st.sessions.map((x) => <li key={x.id} className="flex justify-between"><span>{x.name}</span><span className="text-muted">{x.role}</span></li>)}</ul>}
          </div>
        )}
      </Section>

      {st?.paired && (
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
      )}
    </>
  )
}
