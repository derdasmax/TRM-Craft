import { Play, RotateCw, Square, Skull } from 'lucide-react'
import type { ServerView } from '@trm/core'
import { Button } from './ui'
import { act } from '../lib/act'
import { invoke } from '../lib/bridge'
import { useT } from '../lib/i18n'

export function ServerActions({ s, compact }: { s: ServerView; compact?: boolean }) {
  const t = useT()
  const idle = s.status === 'stopped' || s.status === 'crashed'
  const up = s.status === 'running'
  const label = (k: string) => (compact ? undefined : k)
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {idle && <Button aria-label={t('srv.start')} onClick={() => act(() => invoke('servers.start', s.id))}><Play size={14} strokeWidth={2} />{label(t('srv.start'))}</Button>}
      {up && <Button variant="ghost" aria-label={t('srv.stop')} onClick={() => act(() => invoke('servers.stop', s.id))}><Square size={14} strokeWidth={2} />{label(t('srv.stop'))}</Button>}
      {up && <Button variant="ghost" aria-label={t('srv.restart')} onClick={() => act(() => invoke('servers.restart', s.id))}><RotateCw size={14} strokeWidth={2} />{label(t('srv.restart'))}</Button>}
      {(s.status === 'starting' || s.status === 'stopping') && <Button variant="ghost" aria-label={t('srv.kill')} onClick={() => act(() => invoke('servers.kill', s.id))}><Skull size={14} strokeWidth={2} />{label(t('srv.kill'))}</Button>}
    </div>
  )
}
