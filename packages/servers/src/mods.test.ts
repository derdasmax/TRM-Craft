import archiver from 'archiver'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '@trm/core'
import { ModManager } from './mods'

const rec = (loader: ServerRecord['loader'], id = 's1'): ServerRecord => ({
  id, name: 'T', edition: 'java', loader, mcVersion: '1.21.4', port: 25565, ramMb: 2048, jvmPreset: 'aikar', javaMajor: 21, launch: { type: 'jar', jar: 'server.jar' },
  crossplay: false, backup: { keep: 10 }, notify: { desktop: true, discord: false, joins: false }, autoRestart: true, autostart: false, eulaAcceptedAt: null, createdAt: 'x',
})

const ver = (id: string, project: string, file: string, deps: object[] = [], num = '1.0.0') => ({
  id, project_id: project, name: file, version_number: num, version_type: 'release', game_versions: ['1.21.4'], loaders: ['fabric'], dependencies: deps,
  files: [{ hashes: { sha1: `sha1-${id}`, sha512: `sha512-${id}` }, url: `https://cdn.modrinth.com/data/${project}/${file}`, filename: file, primary: true }],
})

function setup(loader: ServerRecord['loader'] = 'fabric', routes: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'trm-mods-'))
  const downloads: { url: string; sha512?: string; dest: string }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    const key = `${init?.method ?? 'GET'} ${url}`
    const hit = Object.entries(routes).sort((a, b) => b[0].length - a[0].length).find(([k]) => key.includes(k))
    return hit ? new Response(JSON.stringify(hit[1])) : new Response('{}', { status: 404 })
  }) as typeof fetch
  const m = new ModManager({
    servers: { recordOf: () => rec(loader), serverDir: () => root, statusOf: () => 'stopped' },
    fetchImpl, curseKey: () => null,
    download: async (o) => { downloads.push({ url: o.url, sha512: o.sha512, dest: o.dest }); mkdirSync(join(o.dest, '..'), { recursive: true }); writeFileSync(o.dest, 'jar') },
  })
  return { m, root, downloads }
}

async function jar(files: string[], name = 'x.jar'): Promise<string> {
  const p = join(mkdtempSync(join(tmpdir(), 'trm-up-')), name)
  await new Promise<void>((resolve) => {
    const out = createWriteStream(p)
    out.on('close', () => resolve())
    const a = archiver('zip')
    a.pipe(out)
    for (const f of files) a.append('x', { name: f })
    void a.finalize()
  })
  return p
}

describe('ModManager.install (Modrinth)', () => {
  const routes = {
    '/project/AAA/version': [ver('vA', 'AAA', 'a-1.0.jar', [{ project_id: 'BBB', dependency_type: 'required' }, { project_id: 'CCC', dependency_type: 'optional' }])],
    '/project/BBB/version': [ver('vB', 'BBB', 'b-1.0.jar')],
    '/project/AAA': { id: 'AAA', title: 'Mod A', icon_url: null },
    '/project/BBB': { id: 'BBB', title: 'Lib B' },
  }
  it('installiert den Mod samt benötigter Abhängigkeit und meldet Optionales', async () => {
    const { m, root, downloads } = setup('fabric', routes)
    const r = await m.install('s1', 'modrinth', 'AAA')
    expect(r.installed.map((i) => i.file).sort()).toEqual(['a-1.0.jar', 'b-1.0.jar'])
    expect(r.warnings.join()).toContain('CCC')
    expect(existsSync(join(root, 'mods', 'b-1.0.jar'))).toBe(true)
    expect(downloads.every((d) => d.sha512?.startsWith('sha512-'))).toBe(true)
    expect(m.installed('s1').map((i) => i.title)).toEqual(['Lib B', 'Mod A'])
  })
  it('installiert nichts doppelt', async () => {
    const { m, downloads } = setup('fabric', routes)
    await m.install('s1', 'modrinth', 'AAA')
    const n = downloads.length
    expect((await m.install('s1', 'modrinth', 'BBB')).installed).toHaveLength(0)
    expect(downloads.length).toBe(n)
  })
  it('meldet eine fehlende kompatible Version', async () => {
    const { m } = setup('fabric', { '/project/ZZZ/version': [] })
    await expect(m.install('s1', 'modrinth', 'ZZZ')).rejects.toThrow(/Keine Version/)
  })
  it('warnt bei inkompatiblen Abhängigkeiten statt sie zu installieren', async () => {
    const { m } = setup('fabric', { ...routes, '/project/XXX/version': [ver('vX', 'XXX', 'x.jar', [{ project_id: 'BBB', dependency_type: 'incompatible' }])] })
    await m.install('s1', 'modrinth', 'BBB')
    const r = await m.install('s1', 'modrinth', 'XXX')
    expect(r.warnings.join()).toMatch(/nicht mit einem installierten Mod kompatibel/)
  })
  it('lehnt Server ohne Mod-Unterstützung ab', async () => {
    expect(() => setup('vanilla').m.installed('s1')).toThrow(/unterstützt keine/)
  })
})

describe('Aktivieren, Deaktivieren, Entfernen', () => {
  it('benennt Dateien um, ohne sie zu löschen', async () => {
    const { m, root } = setup('fabric', { '/project/BBB/version': [ver('vB', 'BBB', 'b-1.0.jar')], '/project/BBB': { id: 'BBB', title: 'Lib B' } })
    await m.install('s1', 'modrinth', 'BBB')
    m.toggle('s1', 'b-1.0.jar', false)
    expect(existsSync(join(root, 'mods', 'b-1.0.jar.disabled'))).toBe(true)
    expect(m.installed('s1')[0]).toMatchObject({ file: 'b-1.0.jar', enabled: false, title: 'Lib B' })
    m.toggle('s1', 'b-1.0.jar', true)
    expect(m.installed('s1')[0]!.enabled).toBe(true)
    m.remove('s1', 'b-1.0.jar')
    expect(m.installed('s1')).toHaveLength(0)
  })
  it('verhindert Pfad-Tricks', () => {
    const { m } = setup()
    expect(() => m.toggle('s1', '../../etc/passwd.jar', false)).toThrow()
  })
})

describe('Drag & Drop', () => {
  it('installiert passende Dateien und blockiert falsche mit Warnung', async () => {
    const { m, root } = setup('fabric')
    const r = await m.addFiles('s1', [await jar(['fabric.mod.json'], 'ok.jar'), await jar(['META-INF/mods.toml'], 'forge-only.jar'), await jar(['a.class'], 'mystery.jar')])
    expect(r.installed.map((i) => i.file).sort()).toEqual(['mystery.jar', 'ok.jar'])
    expect(r.warnings.join('\n')).toMatch(/forge-only\.jar ist für forge gebaut.*Nicht installiert/)
    expect(r.warnings.join('\n')).toMatch(/mystery\.jar: Der Typ konnte nicht erkannt werden/)
    expect(existsSync(join(root, 'mods', 'forge-only.jar'))).toBe(false)
  })
  it('installiert Inkompatibles nur mit force', async () => {
    const { m } = setup('fabric')
    expect((await m.addFiles('s1', [await jar(['META-INF/mods.toml'], 'f.jar')], true)).installed).toHaveLength(1)
  })
  it('lehnt Nicht-JARs und überschreibt nichts', async () => {
    const { m } = setup('fabric')
    const txt = join(mkdtempSync(join(tmpdir(), 'trm-x-')), 'virus.exe')
    writeFileSync(txt, 'x')
    expect((await m.addFiles('s1', [txt])).warnings[0]).toMatch(/nicht erlaubt/)
    const p = await jar(['fabric.mod.json'], 'dup.jar')
    await m.addFiles('s1', [p])
    expect((await m.addFiles('s1', [p])).warnings[0]).toMatch(/existiert bereits/)
  })
  it('Plugins: Bukkit-Plugin auf Paper ok, auf Velocity nicht', async () => {
    expect((await setup('paper').m.addFiles('s1', [await jar(['plugin.yml'], 'p.jar')])).installed).toHaveLength(1)
    expect((await setup('velocity').m.addFiles('s1', [await jar(['plugin.yml'], 'p.jar')])).installed).toHaveLength(0)
  })
})

describe('Updates', () => {
  it('erkennt und installiert neuere Versionen', async () => {
    const routes: Record<string, unknown> = {
      '/project/BBB/version': [ver('vB1', 'BBB', 'b-1.0.jar', [], '1.0.0')],
      '/project/BBB': { id: 'BBB', title: 'Lib B' },
    }
    const { m, root } = setup('fabric', routes)
    await m.install('s1', 'modrinth', 'BBB')
    routes['POST https://api.modrinth.com/v2/version_files/update'] = { 'sha1-vB1': ver('vB2', 'BBB', 'b-2.0.jar', [], '2.0.0') }
    routes['/project/BBB/version'] = [ver('vB2', 'BBB', 'b-2.0.jar', [], '2.0.0')]
    expect(await m.checkUpdates('s1')).toEqual([{ file: 'b-1.0.jar', title: 'Lib B', from: '1.0.0', to: '2.0.0' }])
    await m.update('s1', 'b-1.0.jar')
    expect(existsSync(join(root, 'mods', 'b-2.0.jar'))).toBe(true)
    expect(existsSync(join(root, 'mods', 'b-1.0.jar'))).toBe(false)
    expect(JSON.parse(readFileSync(join(root, '.trm', 'mods.json'), 'utf8')).files['b-2.0.jar'].version).toBe('2.0.0')
  })
})
