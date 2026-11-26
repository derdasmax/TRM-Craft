// Mock der TRM-Webseite zum Testen der App (siehe docs/remote-api.md).
// Start: node scripts/mock-site.cjs   (benötigt die Pakete ws und archiver, z. B. über `pnpm install` im Repo)
const http = require('http'), crypto = require('crypto'), fs = require('fs')
const { WebSocketServer } = require('ws')
const archiver = require('archiver')
const TOKEN = 'T'.repeat(48)
const results = { pair: null, auth: [], steps: {} }
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/devices/pair') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { results.pair = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ deviceToken: TOKEN, deviceId: 'dev-123', siteName: 'Mock-TRM', perms: { upload: true } })) })
  } else { res.statusCode = 404; res.end() }
})
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, sock, head) => {
  const ok = req.headers.authorization === `Bearer ${TOKEN}`
  results.auth.push(ok)
  wss.handleUpgrade(req, sock, head, (ws) => { if (!ok) return ws.close(4401); wss.emit('connection', ws) })
})
const mkJar = () => new Promise((resolve) => { const chunks = []; const a = archiver('zip'); a.on('data', (c) => chunks.push(c)); a.on('end', () => resolve(Buffer.concat(chunks))); a.append('{}', { name: 'fabric.mod.json' }); a.append(crypto.randomBytes(4000).toString('base64'), { name: 'x.class' }); a.finalize() })
wss.on('connection', (ws) => {
  const pending = new Map(); let n = 0
  const cmd = (command, args, role = 'admin') => new Promise((r) => { const id = `req-${++n}`; pending.set(id, r); ws.send(JSON.stringify({ type: 'cmd', id, command, args, role })) })
  const waitFor = (type, uploadId) => new Promise((r) => { const h = (d) => { const m = JSON.parse(d); if (m.type === type && (!uploadId || m.uploadId === uploadId)) { ws.off('message', h); r(m) } }; ws.on('message', h) })
  ws.on('message', async (d) => {
    const m = JSON.parse(d)
    if (m.type === 'res') { pending.get(m.id)?.(m); pending.delete(m.id) }
    if (m.type !== 'hello') return
    results.hello = { ...m, servers: m.servers.length }
    ws.send(JSON.stringify({ type: 'subscribe', events: ['servers.status'] }))
    results.steps.list = (await cmd('servers.list', undefined, 'viewer')).result?.map((s) => s.name)
    results.steps.viewerStart = (await cmd('servers.start', 'mod-0001', 'viewer')).error
    results.steps.shell = (await cmd('shell.openExternal', 'https://example.com', 'owner')).error
    results.steps.secrets = (await cmd('secrets.set', { name: 'curseforge', value: 'x' }, 'owner')).error
    results.steps.addFiles = (await cmd('mods.addFiles', { id: 'mod-0001', paths: ['/etc/passwd'] }, 'admin')).error
    results.steps.deleteAsAdmin = (await cmd('servers.delete', 'mod-0001', 'admin')).error
    results.steps.traversal = (await cmd('files.read', { id: 'mod-0001', path: '../../settings.json' }, 'admin')).error
    // Upload in zwei Stücken
    const jar = await mkJar(); const sha = crypto.createHash('sha256').update(jar).digest('hex')
    ws.send(JSON.stringify({ type: 'upload.begin', uploadId: 'upl-0001', serverId: 'mod-0001', fileName: 'mock-mod.jar', size: jar.length, sha256: sha, uploader: 'Maxi' }))
    results.steps.ready = await waitFor('upload.ready', 'upl-0001')
    const half = Math.floor(jar.length / 2)
    ws.send(JSON.stringify({ type: 'upload.chunk', uploadId: 'upl-0001', offset: 0, data: jar.subarray(0, half).toString('base64') }))
    await waitFor('upload.ack', 'upl-0001')
    ws.send(JSON.stringify({ type: 'upload.chunk', uploadId: 'upl-0001', offset: half, data: jar.subarray(half).toString('base64') }))
    await waitFor('upload.ack', 'upl-0001')
    ws.send(JSON.stringify({ type: 'upload.end', uploadId: 'upl-0001' }))
    results.steps.done = await waitFor('upload.done', 'upl-0001')
    // kaputter Upload: falsche Prüfsumme
    ws.send(JSON.stringify({ type: 'upload.begin', uploadId: 'upl-0002', serverId: 'mod-0001', fileName: 'bad.jar', size: jar.length, sha256: '0'.repeat(64) }))
    await waitFor('upload.ready', 'upl-0002')
    ws.send(JSON.stringify({ type: 'upload.chunk', uploadId: 'upl-0002', offset: 0, data: jar.toString('base64') }))
    await waitFor('upload.ack', 'upl-0002')
    ws.send(JSON.stringify({ type: 'upload.end', uploadId: 'upl-0002' }))
    results.steps.bad = await waitFor('upload.failed', 'upl-0002')
    fs.writeFileSync('mock-result.json', JSON.stringify(results, null, 1))
  })
})
server.listen(8799, '127.0.0.1', () => console.log('mock site ready'))
setTimeout(() => process.exit(0), 10 * 60_000)
