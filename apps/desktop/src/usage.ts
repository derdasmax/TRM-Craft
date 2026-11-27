import { cpus, freemem, totalmem } from 'node:os'
import type { SystemUsage } from '@trm/core'

export interface CpuTimes { idle: number; total: number }

/** Summe der CPU-Zeiten aller Kerne. */
export function readCpu(list = cpus()): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of list) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

/** Auslastung in Prozent zwischen zwei Messungen. */
export function cpuPercent(a: CpuTimes, b: CpuTimes): number {
  const total = b.total - a.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - (b.idle - a.idle) / total) * 100)))
}

/** Misst alle `ms` Millisekunden und ruft `emit` auf. Gibt eine Stop-Funktion zurück. */
export function startUsageSampler(emit: (u: SystemUsage) => void, ms = 2000): () => void {
  let prev = readCpu()
  const tick = () => {
    const cur = readCpu()
    const totalMb = Math.round(totalmem() / 1048576)
    emit({ cpu: cpuPercent(prev, cur), ramUsedMb: totalMb - Math.round(freemem() / 1048576), ramTotalMb: totalMb })
    prev = cur
  }
  const t = setInterval(tick, ms)
  t.unref?.()
  return () => clearInterval(t)
}
