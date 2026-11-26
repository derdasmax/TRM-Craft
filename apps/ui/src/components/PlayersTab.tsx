import { Ban, Gamepad2, LogOut, Send, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { PlayerAction, PlayerEntry, ServerView } from '@trm/core'
import { Button } from './ui'
import { act, formatUptime } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'

const field = 'no-drag hairline h-9 select-text rounded-ctl bg-raised/60 px-3 text-[13px] outline-none focus:border-accent/50 disabled:opacity-50'
const SKIN_OK = /^\w{3,16}$/

function Head({ name }: { name: string }) {
  // Skin-Kopf nur für gültige Java-Namen. Bedrock-/Floodgate-Namen (mit Punkt oder Leerzeichen) bekommen einen Platzhalter.
  if (!SKIN_OK.test(name)) return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-raised font-mono text-[11px] text-muted">{name[0]?.toUpperCase()}</div>
  return <img src={`https://mc-heads.net/avatar/${name}/32`} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 shrink-0 rounded-[6px] bg-raised [image-rendering:pixelated]" />
}

export function PlayersTab({ server }: { server: ServerView }) {
  const t = useT()
  const [list, setList] = useState<PlayerEntry[]>([])
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')
  const [mode, setMode] = useState('survival')
  const [tpTo, setTpTo] = useState('')
  const live = server.status === 'running'

  useEffect(() => {
    let alive = true
    const load = async () => { const r = await invoke('players.list', server.id).catch(() => []); if (alive) setList(r) }
    void load()
    const i = setInterval(load, 5000)
    return () => { alive = false; clearInterval(i) }
  }, [server.id, server.players.length])

  const run = (action: PlayerAction, name: string, arg?: string) => act(() => invoke('players.action', { id: server.id, action, name, arg }))
  const Btn = ({ a, icon: I, label, arg }: { a: PlayerAction; icon: typeof Ban; label: string; arg?: string }) => (
    <Button variant="ghost" disabled={!live || !target.trim()} onClick={() => run(a, target.trim(), arg)}><I size={14} strokeWidth={1.75} />{label}</Button>
  )

  return (
    <div className="space-y-8">
      <section className="glass rounded-card p-5">
        {!live && <p className="mb-3 text-[12.5px] text-warn">{t('pl.offline')}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('pl.name')}</span><input value={target} onChange={(e) => setTarget(e.target.value)} maxLength={32} className={clsx(field, 'w-full')} /></label>
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('pl.reason')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} className={clsx(field, 'w-full')} /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" disabled={!live || !target.trim()} onClick={() => run('kick', target.trim(), reason || undefined)}><LogOut size={14} />{t('pl.kick')}</Button>
          <Button variant="ghost" disabled={!live || !target.trim()} onClick={() => run('ban', target.trim(), reason || undefined)}><Ban size={14} />{t('pl.ban')}</Button>
          <Btn a="pardon" icon={ShieldOff} label={t('pl.pardon')} />
          <Btn a="op" icon={ShieldCheck} label={t('pl.op')} />
          <Btn a="deop" icon={ShieldOff} label={t('pl.deop')} />
          <Btn a="whitelistAdd" icon={UserPlus} label={t('pl.whitelist')} />
          <Btn a="whitelistRemove" icon={UserPlus} label={t('pl.unwhitelist')} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('pl.gamemode')}</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={clsx(field, 'w-36')}>{['survival', 'creative', 'adventure', 'spectator'].map((m) => <option key={m}>{m}</option>)}</select></label>
          <Btn a="gamemode" icon={Gamepad2} label={t('pl.gamemode')} arg={mode} />
          <label className="block"><span className="mb-1.5 block text-[12.5px] text-muted">{t('pl.target')}</span><input value={tpTo} onChange={(e) => setTpTo(e.target.value)} className={clsx(field, 'w-36')} /></label>
          <Button variant="ghost" disabled={!live || !target.trim() || !tpTo.trim()} onClick={() => run('tp', target.trim(), tpTo.trim())}>{t('pl.tp')}</Button>
        </div>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) void run('say', msg).then(() => setMsg('')) }}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} disabled={!live} placeholder={t('pl.say')} aria-label={t('pl.say')} maxLength={200} className={clsx(field, 'flex-1')} />
          <Button type="submit" disabled={!live || !msg.trim()}><Send size={14} />{t('pl.send')}</Button>
        </form>
      </section>

      {list.length === 0 ? <div className="pixel-grid hairline rounded-card px-6 py-10 text-center text-[13px] text-muted">{t('pl.empty')}</div> : (
        <ul className="divide-y divide-line/[0.08]">
          {list.map((p) => (
            <li key={p.name}>
              <button onClick={() => setTarget(p.name)} className="no-drag flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-raised/30">
                <Head name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-medium">{p.name}{p.online && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">{t('pl.online')}</span>}</div>
                  <div className="text-[12px] text-muted">{t('pl.sessions')}: {p.sessions} · {t('pl.lastSeen')}: {p.online ? t('pl.online') : new Date(p.lastSeen).toLocaleString()}</div>
                </div>
                <div className="text-right font-mono text-[12px] tabular-nums text-muted">{t('pl.playtime')}<br />{formatUptime(p.playMs)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
