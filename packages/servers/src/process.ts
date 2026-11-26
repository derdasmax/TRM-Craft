import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { ServerStatus } from '@trm/core'

export interface LaunchSpec {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export type LogEvent =
  | { type: 'done' }
  | { type: 'join'; name: string }
  | { type: 'leave'; name: string }

const NAME = '[A-Za-z0-9_.]{1,32}'
// Paper/Vanilla/Forge: "Done (3.2s)! For help ...", Velocity: "Done (3.1s)!", BungeeCord/Waterfall: "Listening on /0.0.0.0:25577"
// Bedrock: "Server started."
const DONE = /\]: Done \([\d.,]+s\)!|Listening on \/|\] Server started\./
const JOIN = new RegExp(`\\]: (${NAME}) joined the game\\s*$`)
const LEAVE = new RegExp(`\\]: (${NAME}) left the game\\s*$`)
// Bedrock-Gamertags dürfen Leerzeichen enthalten.
const B_JOIN = /Player connected: (.+?), xuid:/
const B_LEAVE = /Player disconnected: (.+?), xuid:/

/** Erkennt wichtige Ereignisse in einer Minecraft-Logzeile. */
export function parseLogLine(line: string): LogEvent | null {
  if (DONE.test(line)) return { type: 'done' }
  const j = JOIN.exec(line)
  if (j) return { type: 'join', name: j[1]! }
  const l = LEAVE.exec(line)
  if (l) return { type: 'leave', name: l[1]! }
  const bj = B_JOIN.exec(line)
  if (bj) return { type: 'join', name: bj[1]! }
  const bl = B_LEAVE.exec(line)
  if (bl) return { type: 'leave', name: bl[1]! }
  return null
}

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  crashed: boolean
}

interface Events {
  status: [ServerStatus]
  line: [string]
  players: [string[]]
  exit: [ExitInfo]
}

export class ServerProcess extends EventEmitter<Events> {
  status: ServerStatus = 'stopped'
  startedAt: number | null = null
  readonly players = new Set<string>()
  private child: ChildProcessWithoutNullStreams | null = null
  private expectedStop = false
  private buf = ''

  get pid(): number | undefined {
    return this.child?.pid
  }

  private setStatus(s: ServerStatus) {
    if (this.status === s) return
    this.status = s
    this.emit('status', s)
  }

  start(spec: LaunchSpec): void {
    if (this.child) throw new Error('Server läuft bereits.')
    this.expectedStop = false
    this.players.clear()
    this.buf = ''
    this.setStatus('starting')
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env ?? process.env, windowsHide: true })
    this.child = child
    this.startedAt = Date.now()
    const onData = (d: Buffer) => this.onData(d.toString('utf8'))
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.stdin.on('error', () => {})
    child.once('error', (e) => {
      this.emit('line', `[TRM-Craft] Start fehlgeschlagen: ${e.message}`)
      this.finish(null, null)
    })
    child.once('close', (code, signal) => this.finish(code, signal))
  }

  private onData(chunk: string) {
    this.buf += chunk
    const parts = this.buf.split(/\r?\n/)
    this.buf = parts.pop() ?? ''
    for (const line of parts) this.handleLine(line)
  }

  private handleLine(line: string) {
    this.emit('line', line)
    const ev = parseLogLine(line)
    if (!ev) return
    if (ev.type === 'done') this.setStatus('running')
    else if (ev.type === 'join') (this.players.add(ev.name), this.emit('players', [...this.players]))
    else if (this.players.delete(ev.name)) this.emit('players', [...this.players])
  }

  private finish(code: number | null, signal: NodeJS.Signals | null) {
    if (this.buf) this.handleLine(this.buf)
    this.buf = ''
    this.child = null
    this.startedAt = null
    const crashed = !this.expectedStop && code !== 0
    this.players.clear()
    this.emit('players', [])
    this.setStatus(crashed ? 'crashed' : 'stopped')
    this.emit('exit', { code, signal, crashed })
  }

  send(command: string): void {
    // Zeilenumbrüche würden mehrere Befehle einschleusen.
    if (/[\r\n]/.test(command)) throw new Error('Ungültiger Befehl.')
    if (!this.child || this.status === 'stopped' || this.status === 'crashed') throw new Error('Server läuft nicht.')
    this.child.stdin.write(`${command}\n`)
  }

  /** Sauberes Stoppen über den "stop"-Befehl, danach hartes Beenden nach Zeitüberschreitung. */
  stop(timeoutMs = 30_000): Promise<void> {
    const child = this.child
    if (!child) return Promise.resolve()
    this.expectedStop = true
    this.setStatus('stopping')
    return new Promise((resolve) => {
      const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.once('close', () => (clearTimeout(t), resolve()))
      try {
        child.stdin.write('stop\n')
      } catch {
        child.kill('SIGKILL')
      }
    })
  }

  kill(): Promise<void> {
    const child = this.child
    if (!child) return Promise.resolve()
    this.expectedStop = true
    return new Promise((resolve) => {
      child.once('close', () => resolve())
      child.kill('SIGKILL')
    })
  }
}
