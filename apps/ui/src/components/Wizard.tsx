import { AnimatePresence, motion } from 'framer-motion'
import { Check, FileArchive, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { LOADERS, LOADER_INFO, recommendRamMb, type CreateServerInput, type Loader, type SystemMemory, type VersionInfo } from '@trm/core'
import { Button, Segmented, Switch } from './ui'
import { act } from '../lib/act'
import { invoke, pathForFile } from '../lib/bridge'
import { useT, type Key } from '../lib/i18n'
import { useStore } from '../lib/store'

const STEP_LABEL = { software: 'wiz.step.software', version: 'wiz.step.version', details: 'wiz.step.details', ram: 'wiz.step.ram', world: 'wiz.step.world', finish: 'wiz.step.finish' } as const satisfies Record<string, Key>
type StepKey = keyof typeof STEP_LABEL
const GROUPS = { java: ['server', 'mods', 'proxy'], bedrock: ['bedrock'] } as const
const field = 'no-drag hairline h-10 w-full select-text rounded-ctl bg-raised/60 px-3.5 text-[13.5px] outline-none transition-colors placeholder:text-muted focus:border-accent/50'

interface Draft {
  edition: 'java' | 'bedrock'
  crossplay: boolean
  loader: Loader
  mcVersion: string
  name: string
  motd: string
  gamemode: 'survival' | 'creative' | 'adventure'
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard'
  maxPlayers: number
  ramMb: number
  worldMode: 'new' | 'import'
  seed: string
  worldZip: string | null
  eula: boolean
}

const TEMPLATES: { id: string; name: Key; desc: Key; patch: Partial<Draft> }[] = [
  { id: 'survival', name: 'wiz.tpl.survival', desc: 'wiz.tpl.survival.desc', patch: { edition: 'java', loader: 'paper', crossplay: false, gamemode: 'survival', difficulty: 'normal' } },
  { id: 'modded', name: 'wiz.tpl.modded', desc: 'wiz.tpl.modded.desc', patch: { edition: 'java', crossplay: false, loader: 'fabric', gamemode: 'survival', difficulty: 'normal' } },
  { id: 'minigames', name: 'wiz.tpl.minigames', desc: 'wiz.tpl.minigames.desc', patch: { edition: 'java', crossplay: false, loader: 'paper', gamemode: 'adventure', difficulty: 'normal' } },
  { id: 'crossplay', name: 'wiz.tpl.crossplay', desc: 'wiz.tpl.crossplay.desc', patch: { edition: 'java', loader: 'paper', crossplay: true, gamemode: 'survival', difficulty: 'normal' } },
  { id: 'creative', name: 'wiz.tpl.creative', desc: 'wiz.tpl.creative.desc', patch: { edition: 'java', crossplay: false, loader: 'paper', gamemode: 'creative', difficulty: 'peaceful' } },
]

export function Wizard() {
  const t = useT()
  const close = useStore((s) => s.setWizard)
  const progress = useStore((s) => s.progress)
  const openServer = useStore((s) => s.openServer)
  const [step, setStep] = useState(0)
  const [d, setD] = useState<Draft>({ edition: 'java', crossplay: false, loader: 'paper', mcVersion: '', name: '', motd: '', gamemode: 'survival', difficulty: 'normal', maxPlayers: 20, ramMb: 4096, worldMode: 'new', seed: '', worldZip: null, eula: false })
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [vError, setVError] = useState(false)
  const [query, setQuery] = useState('')
  const [mem, setMem] = useState<SystemMemory | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))

  useEffect(() => { invoke('system.memory').then((m) => { setMem(m); setD((x) => ({ ...x, ramMb: recommendRamMb(m.totalMb) })) }) }, [])
  useEffect(() => {
    setVersions(null); setVError(false); setQuery('')
    invoke('versions.list', d.loader).then((v) => { setVersions(v); setD((x) => (v.some((i) => i.id === x.mcVersion) ? x : { ...x, mcVersion: v[0]?.id ?? '' })) }).catch(() => setVError(true))
  }, [d.loader])

  const shown = useMemo(() => (versions ?? []).filter((v) => v.id.includes(query.trim())).slice(0, 80), [versions, query])
  const info = LOADER_INFO[d.loader]
  const proxy = info.proxy
  const bedrock = info.edition === 'bedrock'
  const steps: StepKey[] = proxy ? ['software', 'version', 'details', 'ram', 'finish'] : bedrock ? ['software', 'version', 'details', 'finish'] : ['software', 'version', 'details', 'ram', 'world', 'finish']
  const key = steps[Math.min(step, steps.length - 1)]!
  const valid = { software: true, version: !!d.mcVersion, details: d.name.trim().length > 0, ram: d.ramMb >= 512, world: d.worldMode === 'new' || !!d.worldZip, finish: proxy || d.eula }[key]
  const token = useMemo(() => `create-${Date.now()}`, [])
  const p = progress[token]

  const create = async () => {
    setBusy(t('wiz.creating'))
    const input: CreateServerInput = {
      name: d.name.trim(), loader: d.loader, mcVersion: d.mcVersion, ramMb: bedrock ? 1024 : d.ramMb, acceptEula: true,
      ...(proxy ? {} : {
        motd: d.motd || undefined, gamemode: d.gamemode, difficulty: d.difficulty, maxPlayers: d.maxPlayers,
        seed: d.worldMode === 'new' && d.seed ? d.seed : undefined, worldZip: !bedrock && d.worldMode === 'import' && d.worldZip ? d.worldZip : undefined,
        crossplay: info.crossplay ? d.crossplay : undefined,
      }),
    }
    const r = await act(() => invoke('servers.create', { token, input }))
    setBusy(null)
    if (r) { close(false); openServer(r.id) }
  }

  const gb = (mb: number) => (mb / 1024).toFixed(1)
  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center bg-bg/75 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="wiz-title" className="glass flex max-h-[88vh] w-full max-w-2xl flex-col rounded-card" initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}>
        <div className="flex items-center justify-between px-7 pt-6">
          <h2 id="wiz-title" className="font-display text-[19px] font-semibold">{t('wiz.title')}</h2>
          <button onClick={() => !busy && close(false)} aria-label={t('wiz.cancel')} className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted transition-colors hover:bg-raised hover:text-fg"><X size={16} strokeWidth={1.75} /></button>
        </div>
        <ol className="flex gap-1.5 px-7 pt-4" aria-label="Schritte">
          {steps.map((k, i) => (
            <li key={k} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <div className={clsx('h-1 rounded-full transition-colors duration-300', i <= step ? 'bg-accent' : 'bg-raised')} />
              <div className={clsx('mt-1.5 hidden text-[11.5px] sm:block', i === step ? 'text-fg' : 'text-muted')}>{t(STEP_LABEL[k])}</div>
            </li>
          ))}
        </ol>

        <div className="min-h-[300px] flex-1 overflow-y-auto px-7 py-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}>
              {key === 'software' && (
                <div className="space-y-5">
                  {d.edition === 'java' && <div>
                    <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{t('wiz.template')}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {TEMPLATES.map((tp) => (
                        <button key={tp.id} onClick={() => set(tp.patch)} className="no-drag hairline rounded-ctl bg-raised/40 p-3 text-left transition-[transform,background-color] duration-150 hover:bg-raised active:scale-[0.98]">
                          <div className="text-[13.5px] font-medium">{t(tp.name)}</div>
                          <div className="mt-0.5 text-[12px] text-muted">{t(tp.desc)}</div>
                        </button>
                      ))}
                    </div>
                  </div>}
                  <Segmented id="edition" value={d.edition} onChange={(edition) => set({ edition, crossplay: false, loader: edition === 'bedrock' ? 'bedrock' : 'paper' })} options={[{ value: 'java', label: t('wiz.edition.java') }, { value: 'bedrock', label: t('wiz.edition.bedrock') }]} />
                  {GROUPS[d.edition].map((g) => (
                    <div key={g}>
                      <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{t(`wiz.group.${g}` as Key)}</div>
                      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t(`wiz.group.${g}` as Key)}>
                        {LOADERS.filter((l) => LOADER_INFO[l].group === g).map((l) => (
                          <button key={l} role="radio" aria-checked={d.loader === l} onClick={() => set({ loader: l, crossplay: LOADER_INFO[l].crossplay ? d.crossplay : false })} className={clsx('no-drag rounded-card p-3.5 text-left transition-[transform,border-color] duration-150 active:scale-[0.98]', d.loader === l ? 'border border-accent bg-accent/5' : 'hairline bg-raised/40 hover:bg-raised')}>
                            <div className="font-display text-[14.5px] font-semibold">{LOADER_INFO[l].label}</div>
                            <div className="mt-1 text-[12px] leading-relaxed text-muted">{t(`wiz.loader.${l}.desc` as Key)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {key === 'version' && (
                <div>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('wiz.version.search')} aria-label={t('wiz.version.search')} className={field} />
                  <div className="mt-3 grid max-h-[300px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                    {vError ? <p className="col-span-full text-[13px] text-danger">{t('wiz.version.error')}</p> : versions === null ? <p className="col-span-full text-[13px] text-muted">{t('wiz.version.loading')}</p> : shown.map((v) => (
                      <button key={v.id} onClick={() => set({ mcVersion: v.id })} aria-pressed={d.mcVersion === v.id} className={clsx('no-drag h-9 rounded-ctl font-mono text-[12.5px] transition-[transform,background-color] duration-150 active:scale-[0.96]', d.mcVersion === v.id ? 'bg-accent text-accent-fg' : 'hairline bg-raised/40 hover:bg-raised')}>{v.id}</button>
                    ))}
                  </div>
                </div>
              )}

              {key === 'details' && (
                <div className="space-y-4">
                  <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.name')}</span><input autoFocus value={d.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} className={field} /></label>
                  {proxy && <p className="text-[12.5px] text-muted">{t('wiz.proxyNote')}</p>}
                  {!proxy && <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.motd')}</span><input value={d.motd} maxLength={200} onChange={(e) => set({ motd: e.target.value })} className={field} /></label>}
                  {info.crossplay && (
                    <div className="hairline flex items-center justify-between gap-4 rounded-ctl bg-raised/40 p-4">
                      <div><div className="text-[13.5px] font-medium">{t('wiz.crossplay')}</div><div className="mt-0.5 text-[12px] text-muted">{t('wiz.crossplay.hint')}</div></div>
                      <Switch label={t('wiz.crossplay')} checked={d.crossplay} onChange={(crossplay) => set({ crossplay })} />
                    </div>
                  )}
                  {!proxy && <><div className="grid gap-4 sm:grid-cols-2">
                    <div><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.gamemode')}</span><Segmented id="gm" value={d.gamemode} onChange={(gamemode) => set({ gamemode })} options={(['survival', 'creative', 'adventure'] as const).map((v) => ({ value: v, label: t(`wiz.gm.${v}` as Key) }))} /></div>
                    <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.maxPlayers')}</span><input type="number" min={1} max={1000} value={d.maxPlayers} onChange={(e) => set({ maxPlayers: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })} className={clsx(field, 'font-mono tabular-nums')} /></label>
                  </div>
                  <div><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.difficulty')}</span><Segmented id="diff" value={d.difficulty} onChange={(difficulty) => set({ difficulty })} options={(['peaceful', 'easy', 'normal', 'hard'] as const).map((v) => ({ value: v, label: t(`wiz.diff.${v}` as Key) }))} /></div></>}
                </div>
              )}

              {key === 'ram' && (
                <div>
                  <div className="text-[12.5px] text-muted">{t('wiz.ram')}</div>
                  <div className="mt-2 font-mono text-[34px] font-medium tabular-nums">{gb(d.ramMb)} <span className="text-[16px] text-muted">GB</span></div>
                  <input type="range" min={1024} max={Math.max(4096, Math.min(mem?.totalMb ?? 16384, 65536))} step={512} value={d.ramMb} onChange={(e) => set({ ramMb: Number(e.target.value) })} aria-label={t('wiz.ram')} className="no-drag mt-3 w-full accent-[rgb(var(--accent))]" />
                  {mem && <p className="mt-3 text-[12.5px] text-muted">{t('wiz.ram.hint', { t: (mem.totalMb / 1024).toFixed(0), r: gb(recommendRamMb(mem.totalMb)) })}</p>}
                </div>
              )}

              {key === 'world' && (
                <div className="space-y-4">
                  <Segmented id="world" value={d.worldMode} onChange={(worldMode) => set({ worldMode })} options={[{ value: 'new', label: t('wiz.world.new') }, { value: 'import', label: t('wiz.world.import') }]} />
                  {d.worldMode === 'new' ? (
                    <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('wiz.world.seed')}</span><input value={d.seed} maxLength={100} onChange={(e) => set({ seed: e.target.value })} className={clsx(field, 'font-mono')} /></label>
                  ) : (
                    <label className="hairline flex cursor-pointer items-center gap-3 rounded-ctl bg-raised/40 p-4 transition-colors hover:bg-raised">
                      <FileArchive size={20} strokeWidth={1.5} className="text-accent" />
                      <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-medium">{t('wiz.world.pick')}</span><span className="block truncate text-[12px] text-muted">{d.worldZip ?? t('wiz.world.none')}</span></span>
                      <input type="file" accept=".zip" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) set({ worldZip: pathForFile(f) ?? f.name }) }} />
                    </label>
                  )}
                </div>
              )}

              {key === 'finish' && (
                <div className="space-y-5">
                  <div className="hairline rounded-card bg-raised/40 p-4">
                    <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{t('wiz.summary')}</div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
                      <dt className="text-muted">{t('wiz.name')}</dt><dd className="font-medium">{d.name}</dd>
                      <dt className="text-muted">{t('wiz.step.software')}</dt><dd className="font-mono">{info.label} {d.mcVersion}{d.crossplay ? ' + Crossplay' : ''}</dd>
                      {!bedrock && <><dt className="text-muted">{t('wiz.ram')}</dt><dd className="font-mono">{gb(d.ramMb)} GB</dd></>}
                      {!proxy && <><dt className="text-muted">{t('wiz.gamemode')}</dt><dd>{t(`wiz.gm.${d.gamemode}` as Key)}, {t(`wiz.diff.${d.difficulty}` as Key)}</dd></>}
                    </dl>
                  </div>
                  {/* EULA: nie automatisch akzeptieren, nur aktive Zustimmung. Proxys brauchen keine. */}
                  {!proxy && <label className="flex cursor-pointer items-start gap-3">
                    <button type="button" role="checkbox" aria-checked={d.eula} onClick={() => set({ eula: !d.eula })} className={clsx('no-drag mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] transition-colors duration-150', d.eula ? 'bg-accent text-accent-fg' : 'hairline bg-raised')}>{d.eula && <Check size={13} strokeWidth={3} />}</button>
                    <span className="text-[13.5px]">{t('wiz.eula')} <button type="button" onClick={() => invoke('shell.openExternal', 'https://aka.ms/MinecraftEULA')} className="no-drag text-accent underline underline-offset-2">{t('wiz.eula.link')}</button></span>
                  </label>}
                  {busy && (
                    <div role="status" className="space-y-2">
                      <div className="text-[13px] text-muted">{p?.label ?? busy}</div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-raised"><motion.div className="h-full bg-accent" animate={p?.percent == null ? { x: ['-100%', '250%'], width: '40%' } : { width: `${p.percent}%`, x: 0 }} transition={p?.percent == null ? { repeat: Infinity, duration: 1.1, ease: 'easeInOut' } : { duration: 0.2 }} /></div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-between border-t border-line/[0.08] px-7 py-4">
          <Button variant="ghost" disabled={step === 0 || !!busy} onClick={() => setStep(step - 1)}>{t('wiz.back')}</Button>
          {step < steps.length - 1 ? <Button disabled={!valid} onClick={() => setStep(step + 1)}>{t('wiz.next')}</Button> : <Button disabled={!valid || !!busy} onClick={create}>{busy ?? t('wiz.create')}</Button>}
        </div>
      </motion.div>
    </motion.div>
  )
}
