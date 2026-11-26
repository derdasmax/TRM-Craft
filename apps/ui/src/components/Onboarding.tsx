import { motion } from 'framer-motion'
import { Segmented, Button } from './ui'
import { accents } from '../pages/Settings'
import { useStore } from '../lib/store'
import { useT, type Key } from '../lib/i18n'
import clsx from 'clsx'

export function Onboarding() {
  const t = useT()
  const s = useStore((x) => x.settings)
  const update = useStore((x) => x.update)
  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center bg-bg/80 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="onb-title" className="glass w-full max-w-md rounded-card p-8" initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}>
        <h2 id="onb-title" className="font-display text-[22px] font-semibold tracking-tight">{t('onb.title')}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t('onb.body')}</p>
        <div className="mt-6 flex flex-col gap-4">
          <Segmented id="onb-lang" value={s.language} onChange={(language) => update({ language })} options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} />
          <div className="no-drag flex gap-2">
            {accents.map((a) => (
              <button key={a} data-accent={a} aria-label={t(`accent.${a}` as Key)} aria-pressed={s.accent === a} onClick={() => update({ accent: a })} className={clsx('h-7 w-7 rounded-full bg-accent transition-transform duration-150 active:scale-90', s.accent === a && 'ring-2 ring-fg ring-offset-2 ring-offset-surface')} />
            ))}
          </div>
        </div>
        <Button className="mt-8 w-full" onClick={() => update({ onboardingDone: true })}>{t('onb.start')}</Button>
      </motion.div>
    </motion.div>
  )
}
