import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { ScheduleSpec, ScheduleTask } from '@trm/core'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validateSpec(spec: ScheduleSpec): void {
  if (spec.kind === 'interval' && !(Number.isInteger(spec.everyMinutes) && spec.everyMinutes >= 1 && spec.everyMinutes <= 60 * 24 * 7)) throw new Error('Intervall muss zwischen 1 Minute und 7 Tagen liegen.')
  if (spec.kind === 'daily' && !HHMM.test(spec.time)) throw new Error('Uhrzeit muss HH:MM sein.')
  if (spec.kind === 'weekly' && (!HHMM.test(spec.time) || !spec.days.length || spec.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error('Ungültiger Wochenplan.')
}

/** Nächster Ausführungszeitpunkt nach `after` (Millisekunden, lokale Zeit). */
export function nextRun(spec: ScheduleSpec, after: number): number {
  if (spec.kind === 'interval') return after + spec.everyMinutes * 60_000
  const [h, m] = spec.time.split(':').map(Number) as [number, number]
  const start = new Date(after)
  for (let add = 0; add <= 8; add++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + add, h, m, 0, 0)
    if (d.getTime() <= after) continue
    if (spec.kind === 'weekly' && !spec.days.includes(d.getDay())) continue
    return d.getTime()
  }
  throw new Error('Kein nächster Termin gefunden.')
}

export interface Executors {
  restart(serverId: string, warnSeconds: number): Promise<void>
  backup(serverId: string): Promise<void>
  command(serverId: string, command: string): Promise<void> | void
  announce(serverId: string, message: string): Promise<void> | void
}

/** Wenn ein Termin länger als das zurückliegt (z. B. PC war aus), wird er übersprungen statt nachgeholt. */
const MAX_LATE_MS = 60 * 60_000

export class Scheduler {
  private tasks: ScheduleTask[] = []
  private timer: NodeJS.Timeout | null = null
  private running = new Set<string>()

  constructor(
    private readonly file: string,
    private readonly exec: Executors,
    private readonly now: () => number = Date.now,
    private readonly onError: (task: ScheduleTask, e: unknown) => void = () => {},
  ) {
    try { if (existsSync(file)) this.tasks = (JSON.parse(readFileSync(file, 'utf8')) as { tasks: ScheduleTask[] }).tasks ?? [] } catch { this.tasks = [] }
  }

  private save() {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ tasks: this.tasks }, null, 2))
    renameSync(tmp, this.file)
  }

  list(): ScheduleTask[] { return [...this.tasks] }

  upsert(t: ScheduleTask): ScheduleTask {
    validateSpec(t.spec)
    if (!t.name.trim() || t.name.length > 60) throw new Error('Name fehlt oder ist zu lang.')
    if (t.action.type === 'restart' && !(t.action.warnSeconds >= 0 && t.action.warnSeconds <= 600)) throw new Error('Vorwarnzeit muss zwischen 0 und 600 Sekunden liegen.')
    if (t.action.type === 'command' && (!t.action.command.trim() || /[\r\n]/.test(t.action.command))) throw new Error('Ungültiger Befehl.')
    if (t.action.type === 'announce' && !t.action.message.trim()) throw new Error('Nachricht fehlt.')
    const task: ScheduleTask = { ...t, id: t.id || randomBytes(4).toString('hex'), lastRun: t.lastRun ?? this.now() }
    const i = this.tasks.findIndex((x) => x.id === task.id)
    if (i >= 0) this.tasks[i] = { ...task, lastRun: this.tasks[i]!.lastRun }
    else this.tasks.push(task)
    this.save()
    return task
  }

  remove(id: string) { this.tasks = this.tasks.filter((t) => t.id !== id); this.save() }
  removeForServer(serverId: string) { this.tasks = this.tasks.filter((t) => t.serverId !== serverId); this.save() }

  start(intervalMs = 20_000) { this.stop(); this.timer = setInterval(() => void this.tick(), intervalMs) }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  /** Führt fällige Aufgaben aus. Gibt die IDs der ausgeführten zurück. */
  async tick(): Promise<string[]> {
    const t = this.now()
    const ran: string[] = []
    for (const task of this.tasks) {
      if (!task.enabled || this.running.has(task.id)) continue
      const due = nextRun(task.spec, task.lastRun ?? t)
      if (due > t) continue
      task.lastRun = t
      this.save()
      if (t - due > MAX_LATE_MS) continue
      this.running.add(task.id)
      ran.push(task.id)
      void Promise.resolve(this.run(task)).catch((e: unknown) => this.onError(task, e)).finally(() => this.running.delete(task.id))
    }
    return ran
  }

  private run(task: ScheduleTask): Promise<void> | void {
    const a = task.action
    switch (a.type) {
      case 'restart': return this.exec.restart(task.serverId, a.warnSeconds)
      case 'backup': return this.exec.backup(task.serverId)
      case 'command': return this.exec.command(task.serverId, a.command)
      case 'announce': return this.exec.announce(task.serverId, a.message)
    }
  }
}
