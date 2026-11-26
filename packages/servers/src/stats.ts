import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { cpus } from 'node:os'
import type { StatsSample } from '@trm/core'

/** Paper/Purpur/Folia: "TPS from last 1m, 5m, 15m: 20.0, 19.9, *19.8" (mit Farbcodes). Liefert den 1-Minuten-Wert. */
export function parseTps(line: string): number | null {
  // eslint-disable-next-line no-control-regex
  const clean = line.replace(/\x1b\[[\d;]*m|§[0-9a-fk-or]/gi, '')
  const m = /TPS from last 1m, 5m, 15m:\s*[*]?([\d.]+)/i.exec(clean)
  if (!m) return null
  const v = parseFloat(m[1]!)
  return Number.isFinite(v) ? Math.min(v, 20) : null
}

export interface ProcStat { cpuMs: number; rssBytes: number }

/** CPU-Prozent einer Messung (100 = ein voller Kern). */
export function cpuPercent(prev: ProcStat, cur: ProcStat, dtMs: number): number {
  if (dtMs <= 0) return 0
  return Math.max(0, Math.round(((cur.cpuMs - prev.cpuMs) / dtMs) * 1000) / 10)
}

export type StatReader = (pids: number[]) => Promise<Map<number, ProcStat>>

/** Liest CPU-Zeit und Speicher laufender Prozesse. Windows: ein PowerShell-Aufruf für alle PIDs. Linux (Entwicklung): /proc. */
export const defaultStatReader: StatReader = async (pids) => {
  const out = new Map<number, ProcStat>()
  if (!pids.length) return out
  if (process.platform === 'win32') {
    const ids = pids.filter((p) => Number.isInteger(p) && p > 0).join(',')
    const script = `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.TotalProcessorTime.TotalMilliseconds) $($_.WorkingSet64)" }`
    const text = await new Promise<string>((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 }, (_e, so) => res(so ?? '')))
    for (const line of text.split(/\r?\n/)) {
      const [id, cpu, rss] = line.trim().split(/\s+/)
      if (id && cpu && rss) out.set(Number(id), { cpuMs: parseFloat(cpu.replace(',', '.')), rssBytes: Number(rss) })
    }
    return out
  }
  for (const pid of pids) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const ticks = Number(f[11]) + Number(f[12])
      out.set(pid, { cpuMs: (ticks / 100) * 1000, rssBytes: Number(f[21]) * 4096 })
    } catch { /* Prozess weg */ }
  }
  return out
}

export const CORES = Math.max(1, cpus().length)

/** Ringpuffer mit den letzten Messwerten je Server. */
export class StatsStore {
  private hist = new Map<string, StatsSample[]>()
  constructor(private readonly cap = 360) {}
  push(id: string, s: StatsSample): void {
    const a = this.hist.get(id) ?? []
    a.push(s)
    if (a.length > this.cap) a.splice(0, a.length - this.cap)
    this.hist.set(id, a)
  }
  get(id: string): StatsSample[] { return [...(this.hist.get(id) ?? [])] }
  clear(id: string) { this.hist.delete(id) }
}

/** Erkennt anhaltend niedrige TPS (mehrere Messungen hintereinander unter dem Grenzwert). */
export class LowTpsDetector {
  private streak = new Map<string, number>()
  constructor(private readonly threshold = 15, private readonly needed = 3) {}
  /** Gibt true zurück, genau einmal beim Übergang in den Warnzustand. */
  feed(id: string, tps: number | undefined): boolean {
    if (tps === undefined) return false
    const n = tps < this.threshold ? (this.streak.get(id) ?? 0) + 1 : 0
    this.streak.set(id, n)
    return n === this.needed
  }
}
