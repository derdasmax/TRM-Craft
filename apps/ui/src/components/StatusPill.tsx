import clsx from 'clsx'
import type { ServerStatus } from '@trm/core'
import { useT, type Key } from '../lib/i18n'

const tone: Record<ServerStatus, string> = {
  running: 'bg-accent text-accent',
  starting: 'bg-warn text-warn',
  stopping: 'bg-warn text-warn',
  stopped: 'bg-muted text-muted',
  crashed: 'bg-danger text-danger',
}

export function StatusPill({ status }: { status: ServerStatus }) {
  const t = useT()
  const live = status === 'running' || status === 'starting'
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px]">
      {/* Der Punkt trägt echte Zustandsinformation (Online/Offline), daher pulsiert er nur bei Online. */}
      <span className={clsx('relative h-2 w-2 rounded-full', tone[status].split(' ')[0], status === 'running' && 'pulse-dot')} aria-hidden />
      <span className={clsx(live ? 'text-fg' : tone[status].split(' ')[1])}>{t(`srv.status.${status}` as Key)}</span>
    </span>
  )
}
