import clsx from 'clsx'
import { Download, Search, SendHorizonal } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ServerView } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'
import { lineLevel, parseColored, type Level } from '../lib/mccolors'
import { loadLogs, useStore } from '../lib/store'

const COMMANDS = ['advancement', 'ban', 'ban-ip', 'banlist', 'clear', 'difficulty', 'effect', 'enchant', 'execute', 'experience', 'fill', 'gamemode', 'gamerule', 'give', 'help', 'kick', 'kill', 'list', 'locate', 'msg', 'op', 'pardon', 'publish', 'reload', 'save-all', 'say', 'seed', 'setblock', 'spawnpoint', 'stop', 'summon', 'tag', 'teleport', 'tellraw', 'time', 'title', 'tp', 'weather', 'whitelist', 'worldborder']
const RENDER_LIMIT = 800
const EMPTY: string[] = []
const levelColor: Record<Level, string> = { info: '', warn: 'text-warn', error: 'text-danger' }

const Line = memo(function Line({ text }: { text: string }) {
  const level = lineLevel(text)
  return (
    <div className={clsx('whitespace-pre-wrap break-words', levelColor[level])}>
      {parseColored(text).map((s, i) => (
        <span key={i} style={{ color: level === 'info' ? s.color : undefined, fontWeight: s.bold ? 700 : undefined, fontStyle: s.italic ? 'italic' : undefined, textDecoration: s.underline ? 'underline' : undefined }}>{s.text}</span>
      ))}
    </div>
  )
})

export function Console({ server }: { server: ServerView }) {
  const t = useT()
  const lines = useStore((s) => s.logs[server.id]) ?? EMPTY
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Level>('all')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const online = server.status === 'running' || server.status === 'starting'

  useEffect(() => { void loadLogs(server.id) }, [server.id])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = lines.filter((l) => (filter === 'all' || lineLevel(l) === filter || (filter === 'warn' && lineLevel(l) === 'error')) && (!q || l.toLowerCase().includes(q)))
    return out.slice(-RENDER_LIMIT)
  }, [lines, query, filter])

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible])

  const send = async () => {
    const cmd = input.trim().replace(/^\//, '')
    if (!cmd) return
    setInput('')
    setHIdx(-1)
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 100))
    await act(() => invoke('servers.command', { id: server.id, command: cmd }))
  }

  const suggestion = useMemo(() => {
    const w = input.trimStart()
    if (!w || w.includes(' ')) return null
    return COMMANDS.find((c) => c.startsWith(w.toLowerCase()) && c !== w.toLowerCase()) ?? null
  }, [input])

  const exportLog = () => {
    // eslint-disable-next-line no-control-regex
    const text = lines.map((l) => l.replace(/\x1b\[[\d;]*m|§[0-9a-fk-or]/gi, '')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `${server.name}-log.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="hairline relative flex h-9 min-w-[180px] flex-1 items-center rounded-ctl bg-raised/60">
          <Search size={14} className="absolute left-3 text-muted" strokeWidth={1.75} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('con.search')} aria-label={t('con.search')} className="no-drag h-full w-full select-text bg-transparent pl-9 pr-3 text-[13px] outline-none placeholder:text-muted" />
        </label>
        {(['all', 'warn', 'error'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={clsx('no-drag hairline h-9 rounded-ctl px-3 text-[13px] transition-colors duration-150 active:scale-[0.97]', filter === f ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}>{t(`con.${f}` as 'con.all')}</button>
        ))}
        <Button variant="ghost" onClick={exportLog} disabled={!lines.length}><Download size={14} strokeWidth={1.75} />{t('con.export')}</Button>
      </div>

      <div
        ref={box}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
        className="hairline min-h-0 flex-1 select-text overflow-y-auto rounded-card bg-black/40 p-4 font-mono text-[12.5px] leading-[1.55]"
        role="log"
        aria-live="off"
      >
        {visible.length === 0 ? <p className="text-muted">{online ? '…' : t('con.empty')}</p> : visible.map((l, i) => <Line key={`${i}-${l.length}`} text={l} />)}
      </div>

      <div className="relative">
        <form onSubmit={(e) => { e.preventDefault(); void send() }} className="flex gap-2">
          <div className="relative flex-1">
            {suggestion && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center px-3.5 font-mono text-[13px] text-muted/50"><span className="invisible">{input.trimStart()}</span>{suggestion.slice(input.trimStart().length)}</div>}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!online}
              placeholder={online ? t('con.placeholder') : t('con.offline')}
              aria-label={t('con.placeholder')}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && suggestion) { e.preventDefault(); setInput(`${suggestion} `) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(hIdx + 1, history.length - 1); if (history[n] !== undefined) { setHIdx(n); setInput(history[n]!) } }
                else if (e.key === 'ArrowDown') { e.preventDefault(); const n = hIdx - 1; setHIdx(n); setInput(n >= 0 ? history[n]! : '') }
              }}
              className="no-drag hairline h-10 w-full select-text rounded-ctl bg-raised/60 px-3.5 font-mono text-[13px] outline-none transition-colors placeholder:text-muted focus:border-accent/50 disabled:opacity-50"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={!online || !input.trim()} className="h-10 w-10 px-0" aria-label="Senden"><SendHorizonal size={16} strokeWidth={1.75} /></Button>
        </form>
      </div>
    </div>
  )
}
