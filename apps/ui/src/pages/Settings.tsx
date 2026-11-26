import clsx from 'clsx'
import { useEffect, useState } from 'react'
import type { Accent } from '@trm/core'
import { Button, Row, Section, Segmented, Switch } from '../components/ui'
import { invoke } from '../lib/bridge'
import { useStore } from '../lib/store'
import { useT, type Key } from '../lib/i18n'

export const accents: Accent[] = ['emerald', 'amber', 'violet', 'sky', 'rose']

function Integrations() {
  const t = useT()
  const notify = useStore((x) => x.notify)
  const [has, setHas] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => { invoke('secrets.has', 'curseforge').then(setHas) }, [])
  const save = async () => {
    try { await invoke('secrets.set', { name: 'curseforge', value }); setValue(''); setHas(true) }
    catch (e) { notify(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  return (
    <Section title={t('int.title')}>
      <Row title={t('int.curseforge')} hint={t('int.curseforge.hint')}>
        <div className="flex items-center gap-2">
          {has ? <>
            <span className="text-[12.5px] text-accent">{t('int.set')}</span>
            <Button variant="ghost" onClick={async () => { await invoke('secrets.delete', 'curseforge'); setHas(false) }}>{t('int.remove')}</Button>
          </> : <>
            <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('int.curseforge')} placeholder={t('int.notSet')} className="no-drag hairline h-9 w-48 select-text rounded-ctl bg-raised/60 px-3 font-mono text-[13px] outline-none focus:border-accent/50" />
            <Button disabled={!value.trim()} onClick={save}>{t('int.save')}</Button>
          </>}
        </div>
      </Row>
    </Section>
  )
}

export function Settings() {
  const t = useT()
  const s = useStore((x) => x.settings)
  const info = useStore((x) => x.info)
  const update = useStore((x) => x.update)
  const u = useStore((x) => x.updater)
  const status = !u ? '' : u.phase === 'checking' ? t('upd.checking') : u.phase === 'available' ? t('upd.available', { v: u.version ?? '' }) : u.phase === 'downloading' ? `${t('upd.downloading', { v: u.version ?? '' })} ${Math.round(u.percent ?? 0)} %` : u.phase === 'ready' ? t('upd.ready', { v: u.version ?? '' }) : u.phase === 'error' ? t('upd.error', { e: u.error ?? '' }) : u.phase === 'uptodate' ? t('upd.uptodate') : ''
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-8 font-display text-[26px] font-semibold tracking-tight">{t('settings.title')}</h1>

      <Section title={t('settings.appearance')}>
        <Row title={t('settings.language')}>
          <Segmented id="lang" value={s.language} onChange={(language) => update({ language })} options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} />
        </Row>
        <Row title={t('settings.theme')}>
          <Segmented id="theme" value={s.theme} onChange={(theme) => update({ theme })} options={(['dark', 'light', 'system'] as const).map((v) => ({ value: v, label: t(`settings.theme.${v}` as Key) }))} />
        </Row>
        <Row title={t('settings.accent')}>
          <div className="no-drag flex gap-2" role="radiogroup" aria-label={t('settings.accent')}>
            {accents.map((a) => (
              <button
                key={a}
                role="radio"
                aria-checked={s.accent === a}
                aria-label={t(`accent.${a}` as Key)}
                title={t(`accent.${a}` as Key)}
                data-accent={a}
                onClick={() => update({ accent: a })}
                className={clsx('h-7 w-7 rounded-full bg-accent transition-transform duration-150 ease-out active:scale-90', s.accent === a && 'ring-2 ring-fg ring-offset-2 ring-offset-bg')}
              />
            ))}
          </div>
        </Row>
      </Section>

      <Section title={t('settings.behavior')}>
        <Row title={t('settings.background')} hint={t('settings.background.hint')}>
          <Switch label={t('settings.background')} checked={s.runInBackground} onChange={(runInBackground) => update({ runInBackground })} />
        </Row>
        <Row title={t('settings.notifications')}>
          <Switch label={t('settings.notifications')} checked={s.notifications.desktop} onChange={(desktop) => update({ notifications: { desktop } })} />
        </Row>
      </Section>

      <Integrations />

      <Section title={t('upd.title')}>
        <Row title={t('upd.channel')}>
          <Segmented id="chan" value={s.updates.channel} onChange={(channel) => update({ updates: { channel } })} options={[{ value: 'stable', label: t('upd.channel.stable') }, { value: 'beta', label: t('upd.channel.beta') }]} />
        </Row>
        <Row title={t('upd.auto')} hint={t('upd.auto.hint')}>
          <Switch label={t('upd.auto')} checked={s.updates.autoInstall} onChange={(autoInstall) => update({ updates: { autoInstall } })} />
        </Row>
        <Row title={t('upd.interval')}>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="number" min={1} max={168} value={s.updates.checkIntervalHours} onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 168) update({ updates: { checkIntervalHours: Math.floor(v) } }) }} className="no-drag hairline h-9 w-20 select-text rounded-ctl bg-raised/60 px-3 font-mono text-[13px] text-fg tabular-nums" />
            {t('upd.hours')}
          </label>
        </Row>
        <Row title={status || t('upd.check')} hint={u?.rolledBackFrom ? t('upd.rolledBack', { v: u.rolledBackFrom }) : undefined}>
          <Button variant="ghost" disabled={u?.phase === 'checking' || u?.phase === 'downloading'} onClick={() => invoke('updater.check')}>{t('upd.check')}</Button>
        </Row>
      </Section>

      <Section title={t('settings.about')}>
        <Row title={t('settings.version')}><span className="font-mono text-[13px] text-muted">{info?.version}</span></Row>
        <Row title={t('settings.dataDir')}><span className="select-text truncate font-mono text-[12px] text-muted">{info?.dataDir}</span></Row>
      </Section>
    </div>
  )
}
