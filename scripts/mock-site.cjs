// Mock der TRM-Webseite zum Testen der App (siehe docs/remote-api.md).
// Start:  node scripts/mock-site.cjs            (benötigt die Pakete ws und archiver, z. B. über `pnpm install` im Repo)
//   MODE=ws    (Standard) WebSocket-Verbindung
//   MODE=poll  verweigert WebSockets, damit die App auf HTTPS-Polling umschaltet
// Lauscht auf 127.0.0.1:8799. Das Ergebnis steht in mock-result.json.
const http = require('http'), crypto = require('crypto'), fs = require('fs')
const { WebSocketServer } = require('ws')
const archiver = require('archiver')

const MODE = process.env.MODE || 'ws'
const SERVER_ID = process.env.SERVER_ID || 'mod-0001'
const TOKEN = 'T'.repeat(48)
const results = { mode: MODE, pair: null, pairStart: null, auth: [], steps: {}, snapshots: 0, events: [] }
let pairPolls = 0
const sessions = new Map() // Polling: sessionId -> { inbox: [], waiter: null }

const json = (res, code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(body === undefined ? '' : JSON.stringify(body)) }
const bearer = (req) => req.headers.authorization === `Bearer ${TOKEN}`
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})) })
const paired = { deviceToken: TOKEN, deviceId: 'dev-123', siteName: 'Mock-TRM', perms: { upload: true } }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (req.method === 'POST' && u.pathname === '/api/devices/pair') { results.pair = await readBody(req); return json(res, 200, paired) }
  if (req.method === 'POST' && u.pathname === '/api/devices/pair/start') { results.pairStart = await readBody(req); return json(res, 200, { code: 'WXYZ-9876', pollId: 'poll-abcdef12', expiresInSec: 600 }) }
  if (u.pathname === '/api/devices/pair/status') return json(res, 200, ++pairPolls < 2 ? { status: 'pending' } : { status: 'paired', ...paired })
  // ---- HTTPS-Long-Polling ----
  if (u.pathname.startsWith('/api/agent/')) {
    results.auth.push(bearer(req))
    if (!bearer(req)) return json(res, 401, {})
    if (u.pathname === '/api/agent/session') { const id = `sess-${crypto.randomBytes(6).toString('hex')}`; const s = { inbox: [], waiter: null }; s.send = (m) => { s.inbox.push(m); s.waiter?.() }; sessions.set(id, s); setTimeout(() => attach(s), 0); return json(res, 200, { sessionId: id }) }
    const s = sessions.get(u.searchParams.get('session'))
    if (!s) return json(res, 404, {})
    if (u.pathname === '/api/agent/send') { const { messages } = await readBody(req); messages.forEach((m) => s.onApp?.(m)); return json(res, 204) }
    if (u.pathname === '/api/agent/poll') {
      const flush = () => { const m = s.inbox.splice(0); json(res, 200, { messages: m }) }
      if (s.inbox.length) return flush()
      const t = setTimeout(() => { s.waiter = null; flush() }, Number(u.searchParams.get('wait') || 25) * 1000)
      s.waiter = () => { clearTimeout(t); s.waiter = null; flush() }
      return
    }
  }
  json(res, 404, {})
})

// ---- Gemeinsame Szenario-Logik für WebSocket und Polling ----
function attach(conn) {
  const pending = new Map(); let n = 0; const waiters = []
  const send = (m) => conn.send(m)
  const cmd = (command, args, role = 'admin') => new Promise((r) => { const id = `req-${++n}`; pending.set(id, r); send({ type: 'cmd', id, command, args, role }) })
  const waitFor = (type, uploadId) => new Promise((r) => waiters.push({ type, uploadId, r }))
  const mkJar = () => new Promise((resolve) => { const chunks = []; const a = archiver('zip'); a.on('data', (c) => chunks.push(c)); a.on('end', () => resolve(Buffer.concat(chunks))); a.append('{}', { name: 'fabric.mod.json' }); a.append(crypto.randomBytes(4000).toString('base64'), { name: 'x.class' }); a.finalize() })
  conn.onApp = async (m) => {
    for (let i = 0; i < waiters.length; i++) { const w = waiters[i]; if (m.type === w.type && (!w.uploadId || m.uploadId === w.uploadId)) { waiters.splice(i, 1); w.r(m); break } }
    if (m.type === 'res') { pending.get(m.id)?.(m); pending.delete(m.id) }
    if (m.type === 'snapshot') results.snapshots++
    if (m.type === 'event') results.events.push(m.event)
    if (m.type !== 'hello') return
    results.hello = { ...m, servers: m.servers.length }
    send({ type: 'welcome', protocolVersion: 1, siteName: 'Mock-TRM' })
    send({ type: 'subscribe', events: ['servers.status'] })
    results.steps.list = (await cmd('servers.list', undefined, 'viewer')).result?.map((s) => s.name)
    const bad = await cmd('shell.openExternal', 'https://example.com', 'owner'); results.steps.shell = [bad.code, bad.error]
    const forb = await cmd('servers.start', SERVER_ID, 'viewer'); results.steps.viewerStart = [forb.code, forb.error]
    const jar = await mkJar(); const sha = crypto.createHash('sha256').update(jar).digest('hex')
    send({ type: 'upload.begin', uploadId: 'upl-0001', serverId: SERVER_ID, fileName: 'mock-mod.jar', size: jar.length, sha256: sha, uploader: 'Maxi' })
    await waitFor('upload.ready', 'upl-0001')
    const half = Math.floor(jar.length / 2)
    send({ type: 'upload.chunk', uploadId: 'upl-0001', offset: 0, data: jar.subarray(0, half).toString('base64') }); await waitFor('upload.ack', 'upl-0001')
    send({ type: 'upload.chunk', uploadId: 'upl-0001', offset: half, data: jar.subarray(half).toString('base64') }); await waitFor('upload.ack', 'upl-0001')
    send({ type: 'upload.end', uploadId: 'upl-0001' })
    results.steps.done = await waitFor('upload.done', 'upl-0001')
    fs.writeFileSync('mock-result.json', JSON.stringify(results, null, 1))
  }
}

// ---- WebSocket ----
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, sock, head) => {
  if (MODE === 'poll') { sock.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return sock.destroy() } // WebSockets "blockiert"
  const ok = req.headers.authorization === `Bearer ${TOKEN}`
  results.auth.push(ok)
  wss.handleUpgrade(req, sock, head, (ws) => { if (!ok) return ws.close(4401); wss.emit('connection', ws) })
})
wss.on('connection', (ws) => {
  const conn = { send: (m) => ws.send(JSON.stringify(m)), onApp: null }
  attach(conn)
  ws.on('message', (d) => conn.onApp(JSON.parse(d)))
})

server.listen(8799, '127.0.0.1', () => console.log(`mock site ready (MODE=${MODE})`))
setTimeout(() => process.exit(0), 10 * 60_000)
