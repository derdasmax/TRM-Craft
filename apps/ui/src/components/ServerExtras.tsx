import { ImagePlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { ServerView, SoftwareStatus } from '@trm/core'
import { Button, Row, Section, Switch } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT, type Key } from '../lib/i18n'
import { parseColored } from '../lib/mccolors'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50'

/** Skaliert ein Bild im Browser auf 64x64 und liefert es als PNG (Base64). */
export async function scaleIcon(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  // Mittiger quadratischer Ausschnitt
  const s = Math.min(bmp.width, bmp.height)
  g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 64, 64)
  return c.toDataURL('image/png').split(',')[1]!
}

const SELECTS: Record<string, string[]> = { difficulty: ['peaceful', 'easy', 'normal', 'hard'], gamemode: ['survival', 'creative', 'adventure', 'spectator'] }
const BOOLS = ['pvp', 'online-mode', 'white-list', 'allow-flight']
const NUMS: [string, number, number][] = [['max-players', 1, 1000], ['view-distance', 2, 32], ['spawn-protection', 0, 64]]

export function IconRow({ s }: { s: ServerView }) {
  const t = useT()
  const notify = useStore((x) => x.notify)
  const [icon, setIcon] = useState<string | null>(null)
  useEffect(() => { invoke('servers.getIcon', s.id).then(setIcon) }, [s.id])
  return (
    <Row title={t('ss.icon')} hint={t('ss.icon.hint')}>
      <div className="flex items-center gap-3">
        {icon ? <img src={icon} alt="" className="h-10 w-10 rounded-[6px] [image-rendering:pixelated]" /> : <div className="h-10 w-10 rounded-[6px] bg-raised" />}
        <label className="hairline inline-flex h-9 cursor-pointer items-center gap-2 rounded-ctl bg-raised/60 px-3 text-[13px] transition-colors hover:bg-raised">
          <ImagePlus size={14} strokeWidth={1.75} />{t('ss.icon.pick')}
          <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const png = await scaleIcon(f).catch(() => null)
            if (png && (await act(async () => { await invoke('servers.setIcon', { id: s.id, png }); return true }))) { setIcon(`data:image/png;base64,${png}`); notify(t('srv.saved')) }
          }} />
        </label>
      </div>
    </Row>
  )
}

export function PropertiesForm({ s }: { s: ServerView }) {
  const t = useT()
  const notify = useStore((x) => x.notify)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [orig, setOrig] = useState<Record<string, string>>({})
  useEffect(() => { invoke('servers.properties.get', s.id).then((p) => { setVals(p); setOrig(p) }).catch(() => {}) }, [s.id])
  if (!Object.keys(orig).length) return null
  const set = (k: string, v: string) => setVals((x) => ({ ...x, [k]: v }))
  const changed = Object.fromEntries(Object.entries(vals).filter(([k, v]) => orig[k] !== v))
  const motd = (vals.motd ?? '').replace(/&([0-9a-fk-or])/gi, '§$1')
  return (
    <Section title={t('ss.props')}>
      {Object.entries(SELECTS).filter(([k]) => k in vals).map(([k, opts]) => (
        <Row key={k} title={t(`pr.${k}` as Key)}><select value={vals[k]} onChange={(e) => set(k, e.target.value)} className={clsx(field, 'w-40')} aria-label={t(`pr.${k}` as Key)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></Row>
      ))}
      {BOOLS.filter((k) => k in vals).map((k) => <Row key={k} title={t(`pr.${k}` as Key)}><Switch label={t(`pr.${k}` as Key)} checked={vals[k] === 'true'} onChange={(v) => set(k, String(v))} /></Row>)}
      {NUMS.filter(([k]) => k in vals).map(([k, min, max]) => <Row key={k} title={t(`pr.${k}` as Key)}><input type="number" min={min} max={max} value={vals[k]} onChange={(e) => set(k, String(Math.max(min, Math.min(max, Number(e.target.value) || min))))} className={clsx(field, 'w-24 font-mono tabular-nums')} aria-label={t(`pr.${k}` as Key)} /></Row>)}
      {'motd' in vals && (
        <div className="py-3.5">
          <label className="block text-[13.5px] font-medium" htmlFor="motd">{t('pr.motd')}</label>
          <input id="motd" value={vals.motd} maxLength={200} onChange={(e) => set('motd', e.target.value.replace(/[\r\n]/g, ' '))} className={clsx(field, 'mt-1.5 w-full')} />
          <div className="mt-2 rounded-ctl bg-[#2b2b2b] px-3 py-2 font-mono text-[13px] text-[#aaaaaa]" aria-label={t('pr.motd.preview')}>
            {parseColored(motd).map((sg, i) => <span key={i} style={{ color: sg.color, fontWeight: sg.bold ? 700 : undefined, fontStyle: sg.italic ? 'italic' : undefined }}>{sg.text}</span>)}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between py-3.5">
        <span className="text-[12.5px] text-muted">{t('ss.propsHint')}</span>
        <Button disabled={!Object.keys(changed).length} onClick={async () => { if (await act(async () => { await invoke('servers.properties.set', { id: s.id, values: changed }); return true })) { setOrig(vals); notify(t('ss.propsSaved')) } }}>{t('srv.save')}</Button>
      </div>
    </Section>
  )
}

export function NotifySection({ s }: { s: ServerView }) {
  const t = useT()
  const notify = useStore((x) => x.notify)
  const [hook, setHook] = useState('')
  const [has, setHas] = useState(false)
  useEffect(() => { invoke('secrets.has', `discord:${s.id}`).then(setHas) }, [s.id])
  const patch = (n: Partial<ServerView['notify']>) => act(() => invoke('servers.update', { id: s.id, patch: { notify: { ...s.notify, ...n } } }))
  return (
    <Section title={t('ss.notify')}>
      <Row title={t('ss.notify.desktop')}><Switch label={t('ss.notify.desktop')} checked={s.notify.desktop} onChange={(desktop) => patch({ desktop })} /></Row>
      <Row title={t('ss.notify.joins')}><Switch label={t('ss.notify.joins')} checked={s.notify.joins} onChange={(joins) => patch({ joins })} /></Row>
      <Row title={t('ss.notify.discord')}><Switch label={t('ss.notify.discord')} checked={s.notify.discord} onChange={(discord) => patch({ discord })} /></Row>
      <Row title={t('ss.webhook')}>
        <div className="flex items-center gap-2">
          {has ? <>
            <span className="text-[12.5px] text-accent">{t('ss.webhook.saved')}</span>
            <Button variant="ghost" onClick={async () => { if (await act(async () => { await invoke('notify.discordTest', s.id); return true })) notify(t('ss.webhook.sent')) }}>{t('ss.webhook.test')}</Button>
            <Button variant="ghost" onClick={async () => { await invoke('secrets.delete', `discord:${s.id}`); setHas(false) }}>{t('int.remove')}</Button>
          </> : <>
            <input type="password" autoComplete="off" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://discord.com/api/webhooks/…" aria-label={t('ss.webhook')} className={clsx(field, 'w-64 font-mono')} />
            <Button disabled={!hook.trim()} onClick={async () => { if (await act(async () => { await invoke('secrets.set', { name: `discord:${s.id}`, value: hook }); return true })) { setHook(''); setHas(true) } }}>{t('int.save')}</Button>
          </>}
        </div>
      </Row>
    </Section>
  )
}

export function SoftwareSection({ s }: { s: ServerView }) {
  const t = useT()
  const notify = useStore((x) => x.notify)
  const [st, setSt] = useState<SoftwareStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const stopped = s.status === 'stopped' || s.status === 'crashed'
  useEffect(() => { setSt(null) }, [s.id])
  return (
    <Section title={t('sw.title')}>
      <Row title={`${t('sw.current')}: ${s.loader} ${s.mcVersion}${s.build ? ` · ${t('sw.build')} ${s.build}` : ''}`} hint={st ? (st.available ? `${t('sw.latest')}: ${st.latest}` : st.supported ? t('sw.uptodate') : st.reason) : t('sw.backupNote')}>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={async () => setSt((await act(() => invoke('servers.softwareStatus', s.id))) ?? null)}>{t('sw.check')}</Button>
          {st?.available && <Button disabled={busy || !stopped} onClick={async () => { setBusy(true); const ok = await act(async () => { await invoke('servers.updateSoftware', s.id); return true }); setBusy(false); if (ok) { notify(t('sw.done')); setSt(null) } }}>{busy ? '…' : t('sw.update')}</Button>}
        </div>
      </Row>
    </Section>
  )
}

export function LimitsSection({ s }: { s: ServerView }) {
  const t = useT()
  if (s.edition !== 'java') return null
  const cores = navigator.hardwareConcurrency || 4
  const set = (p: Partial<ServerView['limits']>) => act(() => invoke('servers.update', { id: s.id, patch: { limits: { ...s.limits, ...p } } }))
  return (
    <Section title={t('lim.title')}>
      <Row title={t('lim.cores')} hint={t('lim.hint')}>
        <select value={s.limits.cores ?? 0} onChange={(e) => { const n = Number(e.target.value); void act(() => invoke('servers.update', { id: s.id, patch: { limits: { priority: s.limits.priority, ...(n ? { cores: n } : {}) } } })) }} className={clsx(field, 'w-32')} aria-label={t('lim.cores')}>
          <option value={0}>{t('lim.cores.all')}</option>
          {Array.from({ length: cores - 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Row>
      <Row title={t('lim.priority')}>
        <div className="no-drag hairline inline-flex rounded-ctl bg-raised/60 p-0.5" role="radiogroup">
          {(['low', 'normal', 'high'] as const).map((p) => <button key={p} role="radio" aria-checked={s.limits.priority === p} onClick={() => set({ priority: p })} className={clsx('h-8 rounded-[8px] px-3 text-[13px] transition-colors', s.limits.priority === p ? 'bg-surface text-fg hairline' : 'text-muted hover:text-fg')}>{t(`lim.prio.${p}` as Key)}</button>)}
        </div>
      </Row>
    </Section>
  )
}
