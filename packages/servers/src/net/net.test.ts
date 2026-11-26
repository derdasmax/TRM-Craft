import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ServerRecord, TunnelState } from '@trm/core'
import { Cloudflare, joinHost, validDomain, validLabel } from './cloudflare'
import { Ddns } from './ddns'
import { addArgs, deleteArgs, elevatedPowerShell, Firewall, ruleName } from './firewall'
import { isPrivateIPv4, localIps, publicIp } from './ip'
import { buildJoinInfo } from './join'
import { checkReachable } from './reach'
import { PlayitTunnel, parseClaimUrl, pickPlayitAsset } from './tunnel'
import { assertLan, parseDescription, soapEnvelope, UpnpClient } from './upnp'

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status })
const tmp = () => mkdtempSync(join(tmpdir(), 'trm-net-'))

const server = (o: Partial<ServerRecord> = {}): ServerRecord => ({
  id: 's1', name: 'S', edition: 'java', loader: 'paper', mcVersion: '1.21.4', port: 25565, ramMb: 2048, jvmPreset: 'aikar', javaMajor: 21, launch: { type: 'jar', jar: 'server.jar' },
  crossplay: false, limits: { priority: 'normal' }, backup: { keep: 10 }, notify: { desktop: true, discord: false, joins: false }, autoRestart: true, autostart: false, eulaAcceptedAt: null, createdAt: 'x', ...o,
})

describe('IP', () => {
  it('erkennt private Adressen und sortiert lokale IPs', () => {
    expect(['10.0.0.5', '192.168.1.2', '172.20.0.1', '169.254.1.1'].every(isPrivateIPv4)).toBe(true)
    expect(['8.8.8.8', '172.32.0.1', 'abc'].some(isPrivateIPv4)).toBe(false)
    const ifaces = { a: [{ family: 'IPv4', internal: false, address: '8.8.4.4' }, { family: 'IPv4', internal: false, address: '192.168.0.9' }, { family: 'IPv4', internal: true, address: '127.0.0.1' }, { family: 'IPv6', internal: false, address: 'fe80::1' }] }
    expect(localIps(ifaces as never)).toEqual(['192.168.0.9', '8.8.4.4'])
  })
  it('liest die öffentliche IP und ignoriert Müll', async () => {
    expect(await publicIp((async () => json({ ip: '203.0.113.7' })) as unknown as typeof fetch)).toBe('203.0.113.7')
    expect(await publicIp((async () => json({ ip: '<script>' })) as unknown as typeof fetch)).toBeNull()
    expect(await publicIp((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
})

describe('Erreichbarkeit', () => {
  it('fragt Java und Bedrock getrennt ab und erklärt Fehler', async () => {
    const urls: string[] = []
    const f = (async (u: string) => { urls.push(String(u)); return json({ online: false }) }) as unknown as typeof fetch
    expect((await checkReachable('203.0.113.7', 25565, 'java', f)).hint).toMatch(/TCP-Port 25565/)
    expect((await checkReachable('203.0.113.7', 19132, 'bedrock', f)).hint).toMatch(/UDP-Port 19132/)
    expect(urls).toEqual(['https://api.mcsrvstat.us/3/203.0.113.7:25565', 'https://api.mcsrvstat.us/bedrock/3/203.0.113.7:19132'])
    expect((await checkReachable('203.0.113.7', 25565, 'java', (async () => json({ online: true })) as unknown as typeof fetch)).online).toBe(true)
  })
  it('lehnt ungültige Eingaben ab', async () => {
    await expect(checkReachable('evil.com/x?', 25565, 'java')).rejects.toThrow()
    await expect(checkReachable('1.2.3.4', 70000, 'java')).rejects.toThrow()
  })
})

describe('Join-Adressen', () => {
  const dom = { serverId: 's1', host: 'play.beispiel.net', zoneName: 'beispiel.net', srv: true }
  it('nutzt die Domain ohne Port dank SRV', () => expect(buildJoinInfo(server(), { domain: dom, publicIp: '1.2.3.4' }).java?.address).toBe('play.beispiel.net'))
  it('hängt bei Domain ohne SRV oder IP den Port an', () => {
    expect(buildJoinInfo(server({ port: 25570 }), { domain: { ...dom, srv: false } }).java?.address).toBe('play.beispiel.net:25570')
    expect(buildJoinInfo(server(), { publicIp: '1.2.3.4' }).java?.address).toBe('1.2.3.4')
  })
  it('liefert Bedrock-Adresse mit Port, auch bei Crossplay', () => {
    expect(buildJoinInfo(server({ edition: 'bedrock', loader: 'bedrock', port: 19132 }), { domain: dom }).bedrock).toEqual({ address: 'play.beispiel.net', port: 19132 })
    const j = buildJoinInfo(server({ crossplay: true, bedrockPort: 19133 }), { domain: dom })
    expect(j.java?.address).toBe('play.beispiel.net')
    expect(j.bedrock).toEqual({ address: 'play.beispiel.net', port: 19133 })
  })
  it('bevorzugt den Tunnel und liefert nichts ohne Adresse', () => {
    expect(buildJoinInfo(server(), { tunnel: 'abc.gl.joinmc.link' }).java).toEqual({ address: 'abc.gl.joinmc.link', note: 'Tunnel' })
    expect(buildJoinInfo(server(), {})).toEqual({})
  })
})

describe('UPnP', () => {
  const xml = `<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`
  it('findet den Steuer-Endpunkt und baut sichere SOAP-Nachrichten', () => {
    expect(parseDescription(xml, 'http://192.168.1.1:5000/rootDesc.xml')).toEqual({ serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1', controlUrl: 'http://192.168.1.1:5000/ctl/IPConn' })
    expect(parseDescription('<root/>', 'http://192.168.1.1/')).toBeNull()
    expect(soapEnvelope('urn:x', 'AddPortMapping', { NewPortMappingDescription: '<evil>&"' })).toContain('&#60;evil&#62;&#38;&#34;')
  })
  it('folgt nur Adressen im Heimnetz', () => {
    expect(() => assertLan('http://192.168.1.1:5000/x')).not.toThrow()
    for (const bad of ['http://8.8.8.8/x', 'https://192.168.1.1/x', 'http://evil.com/x', 'http://127.0.0.1/x']) expect(() => assertLan(bad), bad).toThrow()
  })
  it('legt Weiterleitungen an und entfernt sie', async () => {
    const calls: { url: string; action: string; body: string }[] = []
    const f = (async (url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(xml)
      const action = String((init.headers as Record<string, string>).soapaction)
      calls.push({ url, action, body: String(init.body) })
      return new Response(action.includes('GetExternalIPAddress') ? '<NewExternalIPAddress>203.0.113.9</NewExternalIPAddress>' : '<ok/>')
    }) as unknown as typeof fetch
    const c = new UpnpClient({ discover: async () => 'http://192.168.1.1:5000/rootDesc.xml', fetchImpl: f })
    expect(await c.connect()).toBe(true)
    expect(await c.externalIp()).toBe('203.0.113.9')
    await c.addMapping(25565, 'TCP', '192.168.1.20')
    await c.deleteMapping(25565, 'TCP')
    expect(calls[1]!.body).toContain('<NewExternalPort>25565</NewExternalPort>')
    expect(calls[1]!.body).toContain('<NewInternalClient>192.168.1.20</NewInternalClient>')
    expect(calls[2]!.action).toContain('DeletePortMapping')
    await expect(c.addMapping(80, 'TCP', '192.168.1.20')).rejects.toThrow(/Port/)
    await expect(c.addMapping(25565, 'TCP', '8.8.8.8')).rejects.toThrow(/Adresse/)
  })
  it('meldet fehlenden Router und Router-Fehler', async () => {
    expect(await new UpnpClient({ discover: async () => null }).connect()).toBe(false)
    const c = new UpnpClient({ discover: async () => 'http://192.168.1.1/d.xml', fetchImpl: (async (_u: string, i?: RequestInit) => (i?.method ? new Response('<errorDescription>ConflictInMappingEntry</errorDescription>', { status: 500 }) : new Response(xml))) as unknown as typeof fetch })
    await c.connect()
    await expect(c.addMapping(25565, 'TCP', '192.168.1.2')).rejects.toThrow('ConflictInMappingEntry')
  })
})

describe('Firewall', () => {
  it('baut validierte netsh-Argumente', () => {
    expect(addArgs(ruleName('s1', 'TCP', 25565), 'TCP', 25565)).toContain('localport=25565')
    expect(() => addArgs('x"; calc', 'TCP', 25565)).toThrow()
    expect(() => addArgs('ok', 'TCP', 80)).toThrow()
    expect(deleteArgs('TRM-Craft s1 TCP 25565')).toEqual(['advfirewall', 'firewall', 'delete', 'rule', 'name=TRM-Craft s1 TCP 25565'])
  })
  it('maskiert Anführungszeichen für die Administrator-Abfrage', () => {
    expect(elevatedPowerShell(['a', "b'c"])[3]).toContain("'b''c'")
  })
  it('legt Regeln nur an, wenn sie fehlen, und prüft das Ergebnis', async () => {
    const present = new Set<string>()
    const calls: string[] = []
    const exec = async (cmd: string, args: string[]) => {
      calls.push(cmd)
      if (cmd === 'netsh') return { code: present.has(args.find((a) => a.startsWith('name='))!.slice(5)) ? 0 : 1 }
      present.add(ruleName('s1', 'TCP', 25565)) // UAC bestätigt
      return { code: 0 }
    }
    const fw = new Firewall(exec, 'win32')
    await fw.add('s1', [{ proto: 'TCP', port: 25565 }])
    expect(calls.filter((c) => c === 'powershell.exe')).toHaveLength(1)
    await fw.add('s1', [{ proto: 'TCP', port: 25565 }])
    expect(calls.filter((c) => c === 'powershell.exe')).toHaveLength(1)
    await expect(new Firewall(async () => ({ code: 1 }), 'win32').add('s1', [{ proto: 'UDP', port: 19132 }])).rejects.toThrow(/abgelehnt/)
    await expect(new Firewall(exec, 'linux').add('s1', [])).rejects.toThrow(/Windows/)
  })
})

describe('Cloudflare und DDNS', () => {
  it('validiert Domains und Subdomains', () => {
    expect(validDomain('meinname.net')).toBe(true)
    for (const bad of ['', 'a', 'x_y.net', 'evil.com/x', '-a.net', 'a b.net']) expect(validDomain(bad), bad).toBe(false)
    expect(validLabel('play')).toBe(true)
    expect(validLabel('a.b')).toBe(false)
    expect(joinHost('play', 'Meinname.net')).toBe('play.meinname.net')
    expect(joinHost('', 'meinname.net')).toBe('meinname.net')
  })

  function fakeCf() {
    const reqs: { method: string; url: string; body?: Record<string, unknown> }[] = []
    const records = new Map<string, { id: string; type: string; name: string }>()
    const f = (async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      reqs.push({ method, url: u.pathname + u.search, body })
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer TOK')
      const ok = (result: unknown) => json({ success: true, errors: [], result })
      if (u.pathname.endsWith('/tokens/verify')) return ok({ status: 'active' })
      if (u.pathname === '/client/v4/zones') return ok(u.searchParams.get('name') === 'beispiel.net' ? [{ id: 'Z1', name: 'beispiel.net' }] : [])
      if (method === 'GET') { const r = records.get(`${u.searchParams.get('type')}:${u.searchParams.get('name')}`); return ok(r ? [r] : []) }
      if (method === 'POST') { const r = { id: `R${records.size + 1}`, type: body.type, name: body.name }; records.set(`${body.type}:${body.name}`, r); return ok(r) }
      if (method === 'PUT') return ok({ id: u.pathname.split('/').pop(), type: body.type, name: body.name })
      if (method === 'DELETE') return ok({ id: 'x' })
      return json({ success: false, errors: [{ message: 'nope' }] }, 400)
    }) as unknown as typeof fetch
    return { f, reqs }
  }

  it('legt A- und SRV-Eintrag an (ohne Cloudflare-Proxy) und aktualisiert vorhandene', async () => {
    const { f, reqs } = fakeCf()
    const cf = new Cloudflare('TOK', f)
    await cf.verify()
    const zone = await cf.zoneId('beispiel.net')
    await cf.upsertA(zone, 'play.beispiel.net', '203.0.113.7')
    await cf.upsertSrv(zone, 'play.beispiel.net', 25570)
    await cf.upsertA(zone, 'play.beispiel.net', '203.0.113.8')
    const a = reqs.find((r) => r.method === 'POST' && r.body?.type === 'A')!
    expect(a.body).toMatchObject({ name: 'play.beispiel.net', content: '203.0.113.7', proxied: false })
    const srv = reqs.find((r) => r.body?.type === 'SRV')!
    expect(srv.body).toMatchObject({ name: '_minecraft._tcp.play.beispiel.net', data: { port: 25570, target: 'play.beispiel.net' } })
    expect(reqs.some((r) => r.method === 'PUT' && r.body?.content === '203.0.113.8')).toBe(true)
    await expect(cf.zoneId('fremd.net')).rejects.toThrow(/nicht zu diesem/)
  })
  it('erklärt abgelehnte Tokens', async () => {
    const cf = new Cloudflare('x', (async () => json({ success: false, errors: [{ message: 'Invalid' }] }, 403)) as unknown as typeof fetch)
    await expect(cf.verify()).rejects.toThrow(/Berechtigung/)
  })
  it('DDNS: richtet ein, aktualisiert nur bei IP-Wechsel und entfernt', async () => {
    const { f, reqs } = fakeCf()
    let ip = '203.0.113.7'
    const logs: string[] = []
    const d = new Ddns({ file: join(tmp(), 'd.json'), token: () => 'TOK', publicIp: async () => ip, portOf: (id) => (id === 's1' ? 25565 : null), cf: (t) => new Cloudflare(t, f), log: (m) => logs.push(m) })
    const cfg = await d.set('s1', 'Beispiel.net', 'Play', true)
    expect(cfg).toMatchObject({ host: 'play.beispiel.net', srv: true, lastIp: '203.0.113.7' })
    expect(await d.tick()).toBe(0)
    ip = '198.51.100.4'
    expect(await d.tick()).toBe(1)
    expect(d.get('s1')?.lastIp).toBe('198.51.100.4')
    expect(reqs.filter((r) => r.method === 'PUT').at(-1)?.body?.content).toBe('198.51.100.4')
    await expect(d.set('s2', 'beispiel.net', 'play', false)).rejects.toThrow(/Server nicht gefunden/)
    await d.remove('s1')
    expect(d.get('s1')).toBeNull()
    await expect(d.set('s1', 'evil.com/x', '', false)).rejects.toThrow(/Domain/)
    await expect(d.set('s1', 'beispiel.net', 'a.b', false)).rejects.toThrow(/Subdomain/)
  })
  it('DDNS: tut nichts ohne Token oder IP', async () => {
    const d = new Ddns({ file: join(tmp(), 'd.json'), token: () => null, publicIp: async () => null, portOf: () => 1 })
    expect(await d.tick()).toBe(0)
    await expect(d.set('s1', 'beispiel.net', '', false)).rejects.toThrow(/Token/)
  })
})

describe('Tunnel (playit.gg)', () => {
  it('wählt die signierte Windows-Datei und liest die Prüfsumme', () => {
    const assets = [
      { name: 'playit-linux-amd64', browser_download_url: 'https://github.com/a/linux' },
      { name: 'playit-windows-x86_64.exe', browser_download_url: 'https://github.com/a/win' },
      { name: 'playit-windows-x86_64-signed.exe', browser_download_url: 'https://github.com/a/signed', digest: `sha256:${'a'.repeat(64)}` },
    ]
    expect(pickPlayitAsset(assets)).toEqual({ name: 'playit-windows-x86_64-signed.exe', url: 'https://github.com/a/signed', sha256: 'a'.repeat(64) })
    expect(pickPlayitAsset([assets[0]!])).toBeNull()
  })
  it('akzeptiert nur Claim-Links auf playit.gg', () => {
    expect(parseClaimUrl('\x1b[32mVisit link: https://playit.gg/claim/abc123 to setup\x1b[0m')).toBe('https://playit.gg/claim/abc123')
    expect(parseClaimUrl('https://evil.com/playit.gg/claim/x')).toBeUndefined()
    expect(parseClaimUrl('nichts')).toBeUndefined()
  })
  it('startet den Agenten, liest Claim-Link und Status', async () => {
    const states: TunnelState[] = []
    const dir = tmp()
    const script = join(dir, 'agent.mjs')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(script, "console.log('Visit https://playit.gg/claim/xyz'); setTimeout(() => console.log('tunnel running'), 30); setTimeout(() => process.exit(0), 200)")
    const t = new PlayitTunnel({ dir, emit: (s) => states.push(s), command: () => ({ cmd: process.execPath, args: [script] }) })
    await t.start()
    await new Promise((r) => setTimeout(r, 350))
    expect(states.some((s) => s.claimUrl === 'https://playit.gg/claim/xyz')).toBe(true)
    expect(states.some((s) => s.status === 'running')).toBe(true)
    expect(t.state.status).toBe('stopped')
  })
})
