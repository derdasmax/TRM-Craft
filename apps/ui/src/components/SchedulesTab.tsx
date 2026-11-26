import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { ScheduleAction, ScheduleSpec, ScheduleTask, ServerView } from '@trm/core'
import { Button, Switch } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'

const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50'

function describe(t: ReturnType<typeof useT>, lang: string, s: ScheduleTask): string {
  const day = (d: number) => new Date(2026, 0, 4 + d).toLocaleDateString(lang, { weekday: 'short' })
  const when = s.spec.kind === 'interval' ? `${t('sc.every').replace('…', String(s.spec.everyMinutes))}` : s.spec.kind === 'daily' ? `${t('sc.daily')} ${s.spec.time}` : `${s.spec.days.map(day).join(', ')} ${s.spec.time}`
  const what = s.action.type === 'restart' ? `${t('sc.restart')} (${s.action.warnSeconds} s)` : s.action.type === 'backup' ? t('sc.backup') : s.action.type === 'command' ? `/${s.action.command}` : `„${s.action.message}“`
  return `${when} → ${what}`
}

export function SchedulesTab({ server }: { server: ServerView }) {
  const t = useT()
  const lang = useStore((s) => s.settings.language)
  const [tasks, setTasks] = useState<ScheduleTask[]>([])
  const [form, setForm] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ScheduleSpec['kind']>('daily')
  const [minutes, setMinutes] = useState(60)
  const [time, setTime] = useState('04:00')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0])
  const [type, setType] = useState<ScheduleAction['type']>('restart')
  const [warn, setWarn] = useState(60)
  const [text, setText] = useState('')

  const load = useCallback(async () => setTasks(((await act(() => invoke('schedules.list'))) ?? []).filter((x) => x.serverId === server.id)), [server.id])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    const spec: ScheduleSpec = kind === 'interval' ? { kind, everyMinutes: minutes } : kind === 'daily' ? { kind, time } : { kind, days, time }
    const action: ScheduleAction = type === 'restart' ? { type, warnSeconds: warn } : type === 'backup' ? { type } : type === 'command' ? { type, command: text.replace(/^\//, '') } : { type, message: text }
    const r = await act(() => invoke('schedules.save', { id: '', serverId: server.id, name: name.trim() || t(`sc.${type}` as 'sc.restart'), enabled: true, spec, action }))
    if (r) { setForm(false); setName(''); setText(''); void load() }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Button onClick={() => setForm(!form)}><Plus size={14} />{t('sc.add')}</Button></div>
      {form && (
        <section className="glass space-y-4 rounded-card p-5">
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('sc.name')}</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={clsx(field, 'w-full')} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><span className="block text-[12.5px] text-muted">{t('sc.when')}</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleSpec['kind'])} className={clsx(field, 'w-full')}><option value="daily">{t('sc.daily')}</option><option value="weekly">{t('sc.weekly')}</option><option value="interval">{t('sc.interval')}</option></select>
              {kind === 'interval' ? <label className="flex items-center gap-2 text-[13px] text-muted">{t('sc.every')}<input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={clsx(field, 'w-24 font-mono tabular-nums')} /></label> : <label className="flex items-center gap-2 text-[13px] text-muted">{t('sc.time')}<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={clsx(field, 'font-mono')} /></label>}
              {kind === 'weekly' && <div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))} className={clsx('no-drag h-8 rounded-ctl px-2.5 text-[12.5px] transition-colors active:scale-[0.96]', days.includes(d) ? 'bg-accent text-accent-fg' : 'hairline bg-raised/40')}>{new Date(2026, 0, 4 + d).toLocaleDateString(lang, { weekday: 'short' })}</button>)}</div>}
            </div>
            <div className="space-y-2"><span className="block text-[12.5px] text-muted">{t('sc.what')}</span>
              <select value={type} onChange={(e) => setType(e.target.value as ScheduleAction['type'])} className={clsx(field, 'w-full')}><option value="restart">{t('sc.restart')}</option><option value="backup">{t('sc.backup')}</option><option value="command">{t('sc.command')}</option><option value="announce">{t('sc.announce')}</option></select>
              {type === 'restart' && <label className="flex items-center gap-2 text-[13px] text-muted">{t('sc.warn')}<input type="number" min={0} max={600} value={warn} onChange={(e) => setWarn(Number(e.target.value))} className={clsx(field, 'w-24 font-mono tabular-nums')} /></label>}
              {(type === 'command' || type === 'announce') && <input value={text} onChange={(e) => setText(e.target.value)} placeholder={type === 'command' ? t('sc.cmd') : t('sc.msg')} aria-label={type === 'command' ? t('sc.cmd') : t('sc.msg')} maxLength={200} className={clsx(field, 'w-full')} />}
            </div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(false)}>{t('sc.cancel')}</Button><Button onClick={save}>{t('sc.save')}</Button></div>
        </section>
      )}
      {tasks.length === 0 ? <div className="pixel-grid hairline grid place-items-center gap-2 rounded-card px-6 py-10 text-center text-[13px] text-muted"><CalendarClock size={22} strokeWidth={1.5} />{t('sc.empty')}</div> : (
        <ul className="divide-y divide-line/[0.08]">
          {tasks.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{s.name}</div><div className="truncate text-[12.5px] text-muted">{describe(t, lang, s)}</div></div>
              <Switch label={s.name} checked={s.enabled} onChange={async (enabled) => { await act(() => invoke('schedules.save', { ...s, enabled })); void load() }} />
              <button aria-label={t('bk.delete')} onClick={async () => { await act(() => invoke('schedules.delete', s.id)); void load() }} className="no-drag grid h-8 w-8 place-items-center rounded-ctl text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
