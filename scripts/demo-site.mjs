// Beispiel-Client für die Remote-API der App (siehe docs/remote-api.md). Spielt den Ablauf einer Webseite nach:
// Kopplung → Sitzung → Befehle → WebSocket → Upload in Chunks.
//
//   node scripts/demo-site.mjs --api http://127.0.0.1:47821 --origin https://trm.beispiel.de --code ABCD-2345 [--server <id>] [--file mod.jar]
//
// Benötigt Node 20+ und das Paket `ws` (ist im Repo vorhanden). Das Ergebnis steht als JSON auf der Konsole.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const API = arg('api', 'http://127.0.0.1:47821').replace(/\/$/, '')
const ORIGIN = arg('origin', 'https://trm.beispiel.de')
const CODE = arg('code')
const SERVER = arg('server')
const FILE = arg('file')
const OUT = arg('out')
const result = { steps: {} }

async function http(method, path, { token, json, body, query } = {}) {
  const headers = { origin: ORIGIN }
  if (token) headers.authorization = `Bearer ${token}`
  if (json !== undefined) headers['content-type'] = 'application/json'
  if (body) headers['content-type'] = 'application/octet-stream'
  const res = await fetch(`${API}/api/v1${path}${query ?? ''}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : body })
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: await res.json().catch(() => null) }
}

const info = await http('GET', '/info')
result.steps.info = info.body
if (!CODE) { console.log(JSON.stringify(result, null, 2)); process.exit(0) }

// 1. Kopplung: Code aus der App → Geräte-Token (nur auf dem Backend der Webseite speichern!)
const pair = await http('POST', '/pair', { json: { code: CODE, siteName: 'Demo-Webseite' } })
result.steps.pair = { status: pair.status, ...pair.body, deviceToken: pair.body?.deviceToken ? '<geheim>' : undefined }
if (pair.status !== 200) { console.log(JSON.stringify(result, null, 2)); process.exit(1) }
const again = await http('POST', '/pair', { json: { code: CODE } })
result.steps.pairReuse = again.status // Code ist einmalig → 401

// 2. Das Backend holt für den eingeloggten Nutzer ein kurzlebiges Sitzungs-Token (Rolle begrenzt durch Gerät und App-Einstellung)
const sess = await http('POST', '/sessions', { token: pair.body.deviceToken, json: { user: 'Maxi', role: 'owner' } })
result.steps.session = { status: sess.status, role: sess.body?.role, perms: sess.body?.perms }
const token = sess.body.sessionToken

// 3. Befehle über REST
const list = await http('POST', '/cmd', { token, json: { command: 'servers.list' } })
result.steps.list = { status: list.status, count: Array.isArray(list.body?.result) ? list.body.result.length : null }
const local = await http('POST', '/cmd', { token, json: { command: 'shell.openExternal', args: 'https://example.com' } })
result.steps.localOnly = { status: local.status, code: local.body?.code }
const unknown = await http('POST', '/cmd', { token, json: { command: 'gibt.es.nicht' } })
result.steps.unknown = { status: unknown.status, code: unknown.body?.code }

// 4. Fremde Origin wird abgewiesen
const evil = await fetch(`${API}/api/v1/info`, { headers: { origin: 'https://evil.example' } })
result.steps.evilOrigin = evil.status

// 5. WebSocket: Anmeldung, Befehl, Live-Ereignisse
await new Promise((resolve) => {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/api/v1/ws`, { headers: { origin: ORIGIN } })
  const seen = []
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    seen.push(m.type)
    if (m.type === 'hello') { result.steps.ws = { hello: { protocolVersion: m.protocolVersion, role: m.role, servers: m.servers.length } }; ws.send(JSON.stringify({ type: 'subscribe', events: ['servers.status', 'servers.log'] })); ws.send(JSON.stringify({ type: 'cmd', id: 'req-1', command: 'servers.list' })) }
    if (m.type === 'res') { result.steps.ws.cmd = { ok: m.ok }; ws.close() }
  })
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })))
  ws.on('close', resolve)
  ws.on('error', (e) => { result.steps.ws = { error: e.message }; resolve() })
})

// 6. Upload in Chunks mit SHA-256 (nur wenn ein Server und eine Datei angegeben sind)
if (SERVER && FILE) {
  const data = readFileSync(FILE)
  const sha256 = createHash('sha256').update(data).digest('hex')
  const begin = await http('POST', '/uploads', { token, json: { serverId: SERVER, fileName: FILE.split(/[\\/]/).pop(), size: data.length, sha256 } })
  result.steps.uploadBegin = { status: begin.status, ...begin.body }
  if (begin.status === 200) {
    const { uploadId, chunkSize } = begin.body
    let offset = begin.body.received
    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + Math.min(chunkSize, 64 * 1024))
      const r = await http('PUT', `/uploads/${uploadId}`, { token, body: chunk, query: `?offset=${offset}` })
      if (r.status !== 200) { result.steps.uploadChunk = r; break }
      offset = r.body.received
    }
    const fin = await http('POST', `/uploads/${uploadId}/finish`, { token })
    result.steps.uploadFinish = { status: fin.status, ...fin.body }
  }
}

// 7. Sitzung beenden
result.steps.logout = (await http('DELETE', '/sessions/current', { token })).status
result.steps.afterLogout = (await http('GET', '/me', { token })).status
const text = JSON.stringify(result, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(text)
void randomBytes
