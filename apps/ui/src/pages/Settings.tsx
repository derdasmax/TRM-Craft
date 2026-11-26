import clsx from 'clsx'
import type { Accent } from '@trm/core'
import { Row, Section, Segmented, Switch } from '../components/ui'
import { useStore } from '../lib/store'
import { useT, type Key } from '../lib/i18n'

export const accents: Accent[] = ['emerald', 'amber', 'violet', 'sky', 'rose']

export function Settings() {
  const t = useT()
  const s = useStore((x) => x.settings)
  const info = useStore((x) => x.info)
  const update = useStore((x) => x.update)
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

      <Section title={t('settings.about')}>
        <Row title={t('settings.version')}><span className="font-mono text-[13px] text-muted">{info?.version}</span></Row>
        <Row title={t('settings.dataDir')}><span className="select-text truncate font-mono text-[12px] text-muted">{info?.dataDir}</span></Row>
      </Section>
    </div>
  )
}
