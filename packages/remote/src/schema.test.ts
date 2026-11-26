import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSchema } from './schema'
import { InboundSchema, OutboundSchema } from './protocol'

const file = fileURLToPath(new URL('../../../docs/remote-api.schema.json', import.meta.url))
const text = () => `${JSON.stringify(buildSchema(), null, 2)}\n`

describe('docs/remote-api.schema.json', () => {
  it('ist aktuell (neu erzeugen mit UPDATE_SCHEMA=1)', () => {
    if (process.env.UPDATE_SCHEMA === '1') writeFileSync(file, text())
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(text())
  })

  it('enthält alle Nachrichtentypen', () => {
    const s = JSON.stringify(buildSchema())
    for (const t of ['welcome', 'cmd', 'subscribe', 'sessions', 'upload.begin', 'upload.chunk', 'upload.end', 'upload.cancel', 'upload.fetch', 'ping', 'hello', 'snapshot', 'res', 'event', 'pong', 'upload.ready', 'upload.ack', 'upload.done', 'upload.failed']) expect(s, t).toContain(`"${t}"`)
    expect(buildSchema().protocolVersion).toBe(1)
  })

  it('Beispiel-Nachrichten aus der Dokumentation sind gültig', () => {
    expect(InboundSchema.safeParse({ type: 'cmd', id: 'req-1', command: 'servers.start', args: 'survival-3f2a', role: 'moderator', user: 'Maxi' }).success).toBe(true)
    expect(InboundSchema.safeParse({ type: 'welcome', protocolVersion: 1, siteName: 'TRM' }).success).toBe(true)
    expect(OutboundSchema.safeParse({ type: 'res', id: 'req-1', ok: false, error: 'Dafür fehlt die Berechtigung.', code: 'forbidden' }).success).toBe(true)
    expect(OutboundSchema.safeParse({ type: 'res', id: 'req-1', ok: false, error: 'x', code: 'erfunden' }).success).toBe(false)
    expect(OutboundSchema.safeParse({ type: 'upload.failed', uploadId: 'u1', error: 'x', code: 'checksum_mismatch' }).success).toBe(true)
  })
})
