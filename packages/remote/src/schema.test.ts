import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSchema } from './schema'
import { WsInboundSchema, WsOutboundSchema } from './protocol'

const file = fileURLToPath(new URL('../../../docs/remote-api.schema.json', import.meta.url))
const text = () => `${JSON.stringify(buildSchema(), null, 2)}\n`

describe('docs/remote-api.schema.json', () => {
  it('ist aktuell (neu erzeugen mit UPDATE_SCHEMA=1)', () => {
    if (process.env.UPDATE_SCHEMA === '1') writeFileSync(file, text())
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(text())
  })

  it('enthält alle WebSocket-Nachrichtentypen', () => {
    const s = JSON.stringify(buildSchema())
    for (const t of ['auth', 'cmd', 'subscribe', 'ping', 'hello', 'snapshot', 'res', 'event', 'pong', 'error']) expect(s, t).toContain(`"${t}"`)
    expect(buildSchema().protocolVersion).toBe(2)
  })

  it('Beispiel-Nachrichten aus der Dokumentation sind gültig', () => {
    expect(WsInboundSchema.safeParse({ type: 'auth', token: 'trs_abcdefgh' }).success).toBe(true)
    expect(WsInboundSchema.safeParse({ type: 'cmd', id: 'req-1', command: 'servers.start', args: 'survival-3f2a' }).success).toBe(true)
    expect(WsOutboundSchema.safeParse({ type: 'res', id: 'req-1', ok: false, error: 'Dafür fehlt die Berechtigung.', code: 'forbidden' }).success).toBe(true)
    expect(WsOutboundSchema.safeParse({ type: 'res', id: 'req-1', ok: false, error: 'x', code: 'erfunden' }).success).toBe(false)
  })
})
