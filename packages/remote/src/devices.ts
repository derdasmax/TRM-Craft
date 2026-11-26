import { createHash, randomBytes, randomInt } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { DeviceInfo, Role } from '@trm/core'

export type DeviceRole = Extract<Role, 'viewer' | 'moderator' | 'admin'>
export interface Device { id: string; name: string; tokenHash: string; role: DeviceRole; perms: { upload: boolean }; createdAt: number; lastSeen?: number; site?: string }
export interface Session { id: string; user: string; role: Role; deviceId: string; perms: { upload: boolean }; since: number; expiresAt: number }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const RANK: Record<Role, number> = { viewer: 0, moderator: 1, admin: 2, owner: 3 }
export const minRole = (a: Role, b: Role): Role => (RANK[a] <= RANK[b] ? a : b)

/**
 * Gekoppelte Geräte. Das Geräte-Token wird nur einmal bei der Kopplung herausgegeben, gespeichert wird ausschließlich sein SHA-256-Hash.
 * Ein gestohlener `devices.json` verrät daher kein Token.
 */
export class DeviceStore {
  private devices: Device[] = []
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    try { if (existsSync(file)) this.devices = (JSON.parse(readFileSync(file, 'utf8')) as { devices: Device[] }).devices ?? [] } catch { this.devices = [] }
  }
  private save() { const t = `${this.file}.tmp`; writeFileSync(t, JSON.stringify({ devices: this.devices }, null, 2), { mode: 0o600 }); renameSync(t, this.file) }

  add(name: string, perms: { upload: boolean }, role: DeviceRole = 'admin', site?: string): { device: Device; token: string } {
    const token = `trd_${randomBytes(32).toString('base64url')}`
    const device: Device = { id: `dev_${randomBytes(6).toString('hex')}`, name: name.trim().slice(0, 80) || 'Webseite', tokenHash: sha(token), role, perms, createdAt: this.now(), site }
    this.devices.push(device)
    this.save()
    return { device, token }
  }

  verify(token: string): Device | null {
    if (!token.startsWith('trd_')) return null
    const h = sha(token)
    const d = this.devices.find((x) => x.tokenHash === h)
    if (d) { d.lastSeen = this.now() }
    return d ?? null
  }

  get(id: string): Device | undefined { return this.devices.find((d) => d.id === id) }
  count(): number { return this.devices.length }
  revoke(id: string): boolean { const n = this.devices.length; this.devices = this.devices.filter((d) => d.id !== id); if (this.devices.length !== n) this.save(); return this.devices.length !== n }
  info(sessionCount: (id: string) => number): DeviceInfo[] {
    return this.devices.map((d) => ({ id: d.id, name: d.name, role: d.role, canUpload: d.perms.upload, createdAt: d.createdAt, lastSeen: d.lastSeen, sessions: sessionCount(d.id) }))
  }
}

/** Kurzlebige Browser-Sitzungen. Nur im Speicher: Ein Neustart der App beendet alle. */
export class SessionStore {
  private sessions = new Map<string, Session>()
  constructor(private readonly now: () => number = Date.now) {}

  mint(device: Device, user: string, requested: Role, cap: Role, ttlSec = 900): { token: string; session: Session } {
    // Höchstens die Rolle des Geräts und die lokale Obergrenze, nie `owner`.
    const role = minRole(minRole(requested, device.role), cap)
    const token = `trs_${randomBytes(24).toString('base64url')}`
    const session: Session = { id: sha(token).slice(0, 12), user: user.trim().slice(0, 80) || 'Unbekannt', role, deviceId: device.id, perms: { ...device.perms }, since: this.now(), expiresAt: this.now() + ttlSec * 1000 }
    this.sessions.set(sha(token), session)
    return { token, session }
  }

  verify(token: string): Session | null {
    if (!token.startsWith('trs_')) return null
    const key = sha(token)
    const s = this.sessions.get(key)
    if (!s) return null
    if (s.expiresAt <= this.now()) { this.sessions.delete(key); return null }
    return s
  }

  revoke(token: string) { this.sessions.delete(sha(token)) }
  revokeDevice(deviceId: string): number { let n = 0; for (const [k, s] of this.sessions) if (s.deviceId === deviceId) { this.sessions.delete(k); n++ } return n }
  list(): Session[] { this.purge(); return [...this.sessions.values()] }
  countFor(deviceId: string): number { return this.list().filter((s) => s.deviceId === deviceId).length }
  purge() { const t = this.now(); for (const [k, s] of this.sessions) if (s.expiresAt <= t) this.sessions.delete(k) }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // ohne 0/O/1/I

export interface PairingOffer { code: string; expiresAt: number; perms: { upload: boolean } }

/**
 * Kopplungscodes: 8 Zeichen aus 32 (rund 40 Bit), einmalig, 10 Minuten gültig.
 * Falsche Versuche werden pro IP gedrosselt, und nach 10 Fehlversuchen wird der Code ungültig.
 */
export class PairingCodes {
  private offer: PairingOffer | null = null
  private wrong = 0
  private fails = new Map<string, number[]>()
  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 10 * 60_000) {}

  start(perms: { upload: boolean }): PairingOffer {
    const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    this.offer = { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: this.now() + this.ttlMs, perms }
    this.wrong = 0
    return this.offer
  }

  current(): PairingOffer | null { if (this.offer && this.offer.expiresAt <= this.now()) this.offer = null; return this.offer }
  cancel() { this.offer = null }

  /** `limited`: zu viele Versuche von dieser IP. `null`: Code falsch/abgelaufen. */
  attempt(code: string, ip: string): { perms: { upload: boolean } } | 'limited' | null {
    const t = this.now()
    const recent = (this.fails.get(ip) ?? []).filter((x) => t - x < 10 * 60_000)
    if (recent.length >= 8) return 'limited'
    const o = this.current()
    const norm = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const ok = !!o && norm.length === 8 && sha(norm) === sha(o.code.replace('-', ''))
    if (!ok) {
      this.fails.set(ip, [...recent, t])
      if (o && ++this.wrong >= 10) this.offer = null
      return null
    }
    this.offer = null // einmalig
    this.fails.delete(ip)
    return { perms: o!.perms }
  }
}
