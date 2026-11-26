import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { LOADER_INFO, extensionKind } from '@trm/core'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { rank } from '../lib/fuzzy'
import { useT, type Key } from '../lib/i18n'
import { useStore, type ServerTab } from '../lib/store'

interface Item { id: string; label: string; run: () => void }

/** Befehlspalette (Strg+K). Öffnet bewusst ohne Animation: Sie wird oft per Tastatur benutzt. */
export function CommandPalette() {
  const t = useT()
  const st = useStore()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const close = () => st.setPalette(false)

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      { id: 'dash', label: t('cp.go.dashboard'), run: () => st.setPage('dashboard') },
      { id: 'set', label: t('cp.go.settings'), run: () => st.setPage('settings') },
      { id: 'new', label: t('cp.new'), run: () => st.setWizard(true) },
      { id: 'pack', label: t('cp.pack'), run: () => { st.setPage('dashboard'); st.setPack(true) } },
      { id: 'upd', label: t('cp.update'), run: () => void act(() => invoke('updater.check')) },
      { id: 'theme', label: t('cp.theme'), run: () => void st.update({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }) },
      { id: 'lang', label: t('cp.lang'), run: () => void st.update({ language: st.settings.language === 'de' ? 'en' : 'de' }) },
    ]
    for (const s of Object.values(st.servers)) {
      out.push({ id: `o-${s.id}`, label: t('cp.open', { n: s.name }), run: () => st.openServer(s.id) })
      if (s.status === 'stopped' || s.status === 'crashed') out.push({ id: `s-${s.id}`, label: t('cp.start', { n: s.name }), run: () => void act(() => invoke('servers.start', s.id)) })
      if (s.status === 'running') {
        out.push({ id: `x-${s.id}`, label: t('cp.stop', { n: s.name }), run: () => void act(() => invoke('servers.stop', s.id)) })
        out.push({ id: `r-${s.id}`, label: t('cp.restart', { n: s.name }), run: () => void act(() => invoke('servers.restart', s.id)) })
      }
    }
    const cur = st.selected ? st.servers[st.selected] : null
    if (st.page === 'server' && cur) {
      const tabs: [ServerTab, Key][] = [['console', 'srv.tab.console'], ['players', 'tab.players'], ['files', 'tab.files'], ['worlds', 'tab.worlds'], ['backups', 'tab.backups'], ['schedules', 'tab.schedules'], ['perf', 'tab.perf'], ['network', 'tab.network'], ['settings', 'srv.tab.settings']]
      if (LOADER_INFO[cur.loader].extFolder && extensionKind(cur.loader)) tabs.splice(8, 0, ['mods', extensionKind(cur.loader) === 'plugin' ? 'mods.tab.plugin' : 'mods.tab.mod'])
      for (const [id, key] of tabs) out.push({ id: `t-${id}`, label: t('cp.tab', { t: t(key) }), run: () => st.setServerTab(id) })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.servers, st.page, st.selected, st.settings.language])

  const shown = useMemo(() => rank(items, q, (i) => i.label).slice(0, 30), [items, q])
  useEffect(() => setIdx(0), [q])
  useEffect(() => { list.current?.children[idx]?.scrollIntoView({ block: 'nearest' }) }, [idx])

  const run = (i?: Item) => { if (!i) return; close(); i.run() }
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-bg/60 p-6 pt-[14vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={t('cp.placeholder')} className="glass w-full max-w-lg overflow-hidden rounded-card">
        <label className="flex items-center gap-3 border-b border-line/[0.08] px-4">
          <Search size={16} className="text-muted" strokeWidth={1.75} />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cp.placeholder')} aria-label={t('cp.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, shown.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') run(shown[idx])
            }}
            className="no-drag h-12 w-full select-text bg-transparent text-[14px] outline-none placeholder:text-muted focus-visible:outline-none"
          />
        </label>
        <ul ref={list} role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">{t('cp.none')}</li>}
          {shown.map((i, n) => (
            <li key={i.id} role="option" aria-selected={n === idx}>
              <button onMouseMove={() => setIdx(n)} onClick={() => run(i)} className={clsx('no-drag flex w-full items-center justify-between rounded-ctl px-3 py-2.5 text-left text-[13.5px]', n === idx ? 'bg-raised' : '')}>
                <span>{i.label}</span>{n === idx && <CornerDownLeft size={14} className="text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
