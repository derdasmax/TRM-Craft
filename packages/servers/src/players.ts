import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PlayerAction, PlayerEntry } from '@trm/core'

interface Rec { firstSeen: number; lastSeen: number; sessions: number; playMs: number }
interface Data { version: 1; players: Record<string, Rec> }

export const PLAYER_NAME = /^[A-Za-z0-9_. ]{1,32}$/

/** Verlauf und Spielzeit je Spieler, gespeichert pro Server. */
export class PlayerTracker {
  private data: Data = { version: 1, players: {} }
  private online = new Map<string, number>()

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    try { this.data = JSON.parse(readFileSync(file, 'utf8')) as Data } catch { /* neu */ }
    if (!this.data.players) this.data = { version: 1, players: {} }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }

  join(name: string): void {
    const t = this.now()
    const r = this.data.players[name] ?? { firstSeen: t, lastSeen: t, sessions: 0, playMs: 0 }
    r.sessions++
    r.lastSeen = t
    this.data.players[name] = r
    this.online.set(name, t)
    this.save()
  }

  leave(name: string): void {
    const start = this.online.get(name)
    const r = this.data.players[name]
    if (start === undefined || !r) return
    const t = this.now()
    r.playMs += Math.max(0, t - start)
    r.lastSeen = t
    this.online.delete(name)
    this.save()
  }

  /** Server beendet: alle offenen Sitzungen abschließen. */
  leaveAll(): void {
    for (const n of [...this.online.keys()]) this.leave(n)
  }

  list(): PlayerEntry[] {
    const t = this.now()
    return Object.entries(this.data.players)
      .map(([name, r]) => {
        const start = this.online.get(name)
        return { name, online: start !== undefined, firstSeen: r.firstSeen, lastSeen: start !== undefined ? t : r.lastSeen, sessions: r.sessions, playMs: r.playMs + (start !== undefined ? t - start : 0) }
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen)
  }
}

const clean = (s: string) => s.replace(/[\r\n]/g, ' ').trim().slice(0, 200)

/**
 * Baut den Konsolenbefehl für eine Spieleraktion. Namen und Argumente werden streng geprüft,
 * damit keine zusätzlichen Befehle eingeschleust werden können.
 */
export function playerCommand(edition: 'java' | 'bedrock', action: PlayerAction, name: string, arg?: string): string {
  if (action === 'say') {
    const msg = clean(name)
    if (!msg) throw new Error('Nachricht ist leer.')
    return edition === 'bedrock' ? `say ${msg}` : `say ${msg}`
  }
  if (!PLAYER_NAME.test(name)) throw new Error('Ungültiger Spielername.')
  const target = edition === 'bedrock' && name.includes(' ') ? `"${name}"` : name
  if (edition === 'java' && name.includes(' ')) throw new Error('Ungültiger Spielername.')
  switch (action) {
    case 'kick': return `kick ${target}${arg ? ` ${clean(arg)}` : ''}`
    case 'ban': return edition === 'bedrock' ? `kick ${target}${arg ? ` ${clean(arg)}` : ''}` : `ban ${target}${arg ? ` ${clean(arg)}` : ''}`
    case 'pardon': return `pardon ${target}`
    case 'op': return `op ${target}`
    case 'deop': return `deop ${target}`
    case 'whitelistAdd': return edition === 'bedrock' ? `allowlist add ${target}` : `whitelist add ${target}`
    case 'whitelistRemove': return edition === 'bedrock' ? `allowlist remove ${target}` : `whitelist remove ${target}`
    case 'gamemode': {
      if (!['survival', 'creative', 'adventure', 'spectator'].includes(arg ?? '')) throw new Error('Ungültiger Spielmodus.')
      return `gamemode ${arg} ${target}`
    }
    case 'tp': {
      if (!arg || !PLAYER_NAME.test(arg)) throw new Error('Ungültiges Teleport-Ziel.')
      return edition === 'bedrock' ? `tp ${target} ${arg.includes(' ') ? `"${arg}"` : arg}` : `tp ${target} ${arg}`
    }
  }
}
