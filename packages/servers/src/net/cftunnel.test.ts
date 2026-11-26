import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RemoteTunnelInfo } from '@trm/core'
import { Cloudflare } from './cloudflare'
import { CloudflaredRunner, elevated, pickCloudflaredAsset, removeTunnel, setupTunnel } from './cftunnel'

/** Fake der Cloudflare-API mit Zustand. */
function fakeApi(o: { existingTunnel?: boolean; deny?: boolean } = {}) {
  const calls: { m: string; path: string; body?: unknown }[] = []
  const tunnels: { id: string; name: string }[] = o.existingTunnel ? [{ id: 'tun-1', name: 'TRM-Craft' }] : []
  const dns: { id: string; type: string; name: string }[] = []
  const reply = (result: unknown) => ({ status: 200, json: async () => ({ success: true, errors: [], result }) })
  const f = (async (url: string, init: { method: string; body?: string }) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ m: init.method, path, body })
    if (o.deny) return { status: 403, json: async () => ({ success: false, errors: [{ message: 'nope' }] }) }
    if (path === '/user/tokens/verify') return reply({ status: 'active' })
    if (path.startsWith('/zones?name=')) return reply([{ id: 'zone-1', name: 'beispiel.de', account: { id: 'acc-1' } }])
    if (path.startsWith('/accounts/acc-1/cfd_tunnel?name=')) return reply(tunnels)
    if (init.method === 'POST' && path === '/accounts/acc-1/cfd_tunnel') { tunnels.push({ id: 'tun-1', name: body.name }); return reply({ id: 'tun-1' }) }
    if (path.endsWith('/token')) return reply('eyJhIjoiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoifQ==')
    if (path.endsWith('/configurations')) return reply({})
    if (path.includes('/dns_records') && init.method === 'GET') return reply(dns.filter((d) => path.includes(`name=${encodeURIComponent(d.name)}`)))
    if (path.includes('/dns_records') && init.method === 'POST') { dns.push({ id: 'd1', type: body.type, name: body.name }); return reply({ id: 'd1', type: body.type, name: body.name }) }
    if (path.includes('/dns_records/') && init.method === 'DELETE') { dns.length = 0; return reply({ id: 'd1' }) }
    if (init.method === 'DELETE') return reply({})
    return { status: 404, json: async () => ({ success: false, errors: [] }) }
  }) as never
  return { cf: new Cloudflare('tok', f), calls, dns }
}

describe('Cloudflare-Tunnel-Assistent', () => {
  it('legt Tunnel, Weiterleitung und CNAME an', async () => {
    const t = fakeApi()
    const r = await setupTunnel(t.cf, { domain: 'beispiel.de', sub: 'craft', port: 47821 })
    expect(r.meta).toMatchObject({ host: 'craft.beispiel.de', tunnelId: 'tun-1', accountId: 'acc-1', zoneId: 'zone-1' })
    expect(r.tunnelToken.length).toBeGreaterThan(20)
    const cfg = t.calls.find((c) => c.path.endsWith('/configurations'))!.body as { config: { ingress: { hostname?: string; service: string }[] } }
    expect(cfg.config.ingress[0]).toMatchObject({ hostname: 'craft.beispiel.de', service: 'http://127.0.0.1:47821' })
    expect(cfg.config.ingress.at(-1)!.service).toBe('http_status:404')
    expect(t.calls.find((c) => c.m === 'POST' && c.path.includes('/dns_records'))!.body).toMatchObject({ type: 'CNAME', name: 'craft.beispiel.de', content: 'tun-1.cfargotunnel.com', proxied: true })
  })

  it('ist idempotent: vorhandener Tunnel wird weiterverwendet', async () => {
    const t = fakeApi({ existingTunnel: true })
    await setupTunnel(t.cf, { domain: 'beispiel.de', sub: 'craft', port: 47821 })
    expect(t.calls.some((c) => c.m === 'POST' && c.path === '/accounts/acc-1/cfd_tunnel')).toBe(false)
  })

  it('prüft Eingaben und meldet fehlende Rechte verständlich', async () => {
    const t = fakeApi()
    await expect(setupTunnel(t.cf, { domain: 'kein domain', sub: 'craft', port: 1 })).rejects.toThrow(/Domain/)
    await expect(setupTunnel(t.cf, { domain: 'beispiel.de', sub: 'a/b', port: 1 })).rejects.toThrow(/Name/)
    await expect(setupTunnel(t.cf, { domain: 'beispiel.de', sub: '', port: 1 })).rejects.toThrow(/Name/)
    await expect(setupTunnel(fakeApi({ deny: true }).cf, { domain: 'beispiel.de', sub: 'craft', port: 1 })).rejects.toThrow(/Berechtigung/)
  })

  it('Entfernen löscht CNAME und Tunnel', async () => {
    const t = fakeApi()
    const r = await setupTunnel(t.cf, { domain: 'beispiel.de', sub: 'craft', port: 47821 })
    await removeTunnel(t.cf, r.meta)
    expect(t.calls.some((c) => c.m === 'DELETE' && c.path === '/accounts/acc-1/cfd_tunnel/tun-1')).toBe(true)
    expect(t.dns).toHaveLength(0)
  })
})

describe('cloudflared', () => {
  it('wählt die Windows-Datei', () => {
    const a = pickCloudflaredAsset([{ name: 'cloudflared-linux-amd64', browser_download_url: 'https://x/l' }, { name: 'cloudflared-windows-amd64.exe', browser_download_url: 'https://x/w', digest: `sha256:${'a'.repeat(64)}` }])
    expect(a).toMatchObject({ url: 'https://x/w', sha256: 'a'.repeat(64) })
    expect(pickCloudflaredAsset([])).toBeNull()
  })

  it('zeigt Verbindungsstatus aus der Ausgabe und gibt den Token nicht preis', async () => {
    const seen: RemoteTunnelInfo[] = []
    const token = 'eyJhIjoiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoifQ=='
    const r = new CloudflaredRunner({
      dir: mkdtempSync(join(tmpdir(), 'trm-cf-')), emit: (i) => seen.push(i),
      command: () => ({ cmd: process.execPath, args: ['-e', `console.log('token ' + process.env.TUNNEL_TOKEN); console.log('INF Registered tunnel connection connIndex=0'); setTimeout(()=>{}, 300)`] }),
    })
    await r.start(token)
    await new Promise<void>((res) => { const i = setInterval(() => { if (r.info.phase === 'connected') { clearInterval(i); res() } }, 20) })
    const text = r.info.lines.join('\n')
    expect(text).toContain('token ***')
    expect(text).not.toContain(token)
    r.stop()
    expect(r.info.phase).toBe('none')
  })

  it('lehnt ungültige Tokens ab und baut die Admin-Zeile sicher', async () => {
    const r = new CloudflaredRunner({ dir: mkdtempSync(join(tmpdir(), 'trm-cf-')), emit: () => {}, command: () => ({ cmd: 'x', args: [] }) })
    await r.start("abc'; rm -rf /")
    expect(r.info.phase).toBe('error')
    await expect(r.installService('x y')).rejects.toThrow()
    const a = elevated("C:\\a'b\\cloudflared.exe", ['service', 'install', 'TOK'])
    expect(a.at(-1)).toContain("'C:\\a''b\\cloudflared.exe'")
    expect(a.at(-1)).toContain("'service','install','TOK'")
  })

  it('Dienst-Installation läuft über UAC und meldet Ablehnung', async () => {
    const calls: string[][] = []
    const mk = (code: number) => new CloudflaredRunner({ dir: mkdtempSync(join(tmpdir(), 'trm-cf-')), emit: () => {}, platform: 'win32', command: () => ({ cmd: 'x', args: [] }), exec: async (_c, a) => { calls.push(a); return { code } } })
    const ok = mk(0)
    await ok.installService('eyJhIjoiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoifQ==')
    expect(ok.info.serviceInstalled).toBe(true)
    expect(calls[0]!.at(-1)).toContain('RunAs')
    await expect(mk(1).installService('eyJhIjoiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoifQ==')).rejects.toThrow(/abgelehnt/)
    await expect(new CloudflaredRunner({ dir: '/x', emit: () => {}, platform: 'linux' }).installService('eyJhIjoiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoifQ==')).rejects.toThrow(/Windows/)
  })
})
