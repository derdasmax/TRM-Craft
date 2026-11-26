import archiver from 'archiver'
import nbt from 'prismarine-nbt'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScheduleTask, ServerStatus } from '@trm/core'
import { BackupService, withSaveLock, type SaveHost } from './backups'
import { diffServerEvents, discordPayload, isDiscordWebhook, sendDiscord } from './events'
import { nextRun, Scheduler, validateSpec } from './scheduler'
import { cpuPercent, LowTpsDetector, parseTps, StatsStore } from './stats'
import { activeWorld, exportWorld, importWorldZip, listWorlds, readSeed, resetWorld } from './worlds'

const tmp = (p = 'trm-ops-') => mkdtempSync(join(tmpdir(), p))

function host(dir: string, status: ServerStatus = 'stopped', edition: 'java' | 'bedrock' = 'java') {
  const cmds: string[] = []
  let listener: ((l: string) => void) | null = null
  const h: SaveHost = {
    dir, edition, status: () => status,
    command: (c) => {
      cmds.push(c)
      if (c === 'save-all flush') setTimeout(() => listener?.('[12:00:00] [Server thread/INFO]: Saved the game'), 5)
      if (c === 'save query') listener?.('Data saved. Files are now ready to be copied.')
    },
    onLine: (fn) => { listener = fn; return () => { listener = null } },
  }
  return { h, cmds }
}

function serverDir() {
  const d = tmp()
  mkdirSync(join(d, 'world'), { recursive: true })
  mkdirSync(join(d, 'logs'))
  mkdirSync(join(d, '.trm'))
  writeFileSync(join(d, 'world', 'level.dat'), 'x')
  writeFileSync(join(d, 'server.properties'), 'level-name=world\nmotd=A\n')
  writeFileSync(join(d, 'logs', 'latest.log'), 'log')
  writeFileSync(join(d, '.trm', 'mods.json'), '{}')
  return d
}

describe('Backups', () => {
  it('erstellt ein ZIP ohne Logs und interne Daten, und beschneidet alte Backups', async () => {
    const dir = serverDir()
    const bdir = tmp('trm-bk-')
    const svc = new BackupService()
    const { h } = host(dir)
    const a = await svc.create(h, bdir, 2, 'Test Label', new Date(2026, 0, 1, 10, 0, 0))
    await svc.create(h, bdir, 2, undefined, new Date(2026, 0, 2, 10, 0, 0))
    await svc.create(h, bdir, 2, undefined, new Date(2026, 0, 3, 10, 0, 0))
    expect(a.file).toBe('2026-01-01_10-00-00_test-label.zip')
    const list = svc.list(bdir)
    expect(list).toHaveLength(2)
    const { default: extract } = await import('extract-zip')
    const out = tmp('trm-chk-')
    await extract(join(bdir, list[0]!.file), { dir: out })
    expect(existsSync(join(out, 'world', 'level.dat'))).toBe(true)
    expect(existsSync(join(out, 'logs'))).toBe(false)
    expect(existsSync(join(out, '.trm'))).toBe(false)
  })
  it('schließt den Backup-Ordner aus, wenn er im Server liegt', async () => {
    const dir = serverDir()
    const bdir = join(dir, 'backups')
    const svc = new BackupService()
    await svc.create(host(dir).h, bdir, 5)
    await svc.create(host(dir).h, bdir, 5, 'zwei', new Date(Date.now() + 5000))
    const { default: extract } = await import('extract-zip')
    const out = tmp('trm-chk-')
    await extract(join(bdir, svc.list(bdir)[0]!.file), { dir: out })
    expect(existsSync(join(out, 'backups'))).toBe(false)
  })
  it('stellt wieder her (nur bei gestopptem Server) und sichert vorher den Ist-Zustand', async () => {
    const dir = serverDir()
    const bdir = tmp('trm-bk-')
    const svc = new BackupService()
    const b = await svc.create(host(dir).h, bdir, 10, 'gut', new Date(2026, 0, 1))
    writeFileSync(join(dir, 'world', 'level.dat'), 'KAPUTT')
    writeFileSync(join(dir, 'extra.txt'), 'neu')
    await expect(svc.restore(host(dir, 'running').h, bdir, 10, b.file)).rejects.toThrow(/Stoppe/)
    await svc.restore(host(dir).h, bdir, 10, b.file)
    expect(readFileSync(join(dir, 'world', 'level.dat'), 'utf8')).toBe('x')
    expect(existsSync(join(dir, 'extra.txt'))).toBe(false)
    expect(existsSync(join(dir, '.trm', 'mods.json'))).toBe(true)
    expect(svc.list(bdir).some((x) => x.label === 'vor-wiederherstellung')).toBe(true)
  })
  it('verhindert Pfad-Tricks beim Löschen und Wiederherstellen', async () => {
    const svc = new BackupService()
    const bdir = tmp('trm-bk-')
    expect(() => svc.delete(bdir, '../../x.zip')).not.toThrow() // wird auf den Dateinamen reduziert
    await expect(svc.restore(host(serverDir()).h, bdir, 5, 'nicht-da.zip')).rejects.toThrow(/nicht gefunden/)
    expect(() => svc.delete(bdir, 'x.exe')).toThrow()
  })
})

describe('withSaveLock', () => {
  it('hält das Speichern an und gibt es wieder frei (Java)', async () => {
    const { h, cmds } = host(tmp(), 'running')
    await withSaveLock(h, async () => { cmds.push('FN') })
    expect(cmds).toEqual(['save-off', 'save-all flush', 'FN', 'save-on'])
  })
  it('gibt auch bei Fehlern frei', async () => {
    const { h, cmds } = host(tmp(), 'running')
    await expect(withSaveLock(h, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(cmds.at(-1)).toBe('save-on')
  })
  it('nutzt hold/query/resume bei Bedrock', async () => {
    const { h, cmds } = host(tmp(), 'running', 'bedrock')
    await withSaveLock(h, async () => {})
    expect(cmds[0]).toBe('save hold')
    expect(cmds.at(-1)).toBe('save resume')
  })
  it('wartet bei gestopptem Server nicht', async () => {
    const { h, cmds } = host(tmp())
    await withSaveLock(h, async () => {})
    expect(cmds).toEqual([])
  })
})

describe('Welten', () => {
  it('listet Welten, liest den Seed aus level.dat und kennt die aktive Welt', async () => {
    const dir = tmp()
    mkdirSync(join(dir, 'world'))
    mkdirSync(join(dir, 'andere'))
    const tag = nbt.comp({ Data: nbt.comp({ WorldGenSettings: nbt.comp({ seed: nbt.long(-1234567890123n as never) }) }) }, '')
    writeFileSync(join(dir, 'world', 'level.dat'), gzipSync(nbt.writeUncompressed(tag as never)))
    writeFileSync(join(dir, 'andere', 'level.dat'), 'x')
    writeFileSync(join(dir, 'server.properties'), 'level-name=andere\n')
    const w = await listWorlds(dir)
    expect(activeWorld(dir)).toBe('andere')
    expect(w.map((x) => [x.name, x.active])).toEqual([['andere', true], ['world', false]])
    expect(w.find((x) => x.name === 'world')?.seed).toBe('-1234567890123')
    expect(await readSeed(join(dir, 'andere', 'level.dat'))).toBeUndefined()
  })
  it('exportiert, setzt zurück und importiert Welten', async () => {
    const dir = serverDir()
    mkdirSync(join(dir, 'world_nether'))
    writeFileSync(join(dir, 'world_nether', 'x.txt'), 'n')
    const zip = join(tmp(), 'w.zip')
    await exportWorld(dir, 'world', zip)
    await expect(exportWorld(dir, '../etc', zip)).rejects.toThrow()
    resetWorld(dir, 'world')
    expect(existsSync(join(dir, 'world'))).toBe(false)
    expect(existsSync(join(dir, 'world_nether'))).toBe(false)
    expect(() => resetWorld(dir, '../x')).toThrow()
    const name = await importWorldZip(zip, dir, 'world')
    expect(name).toBe('world')
    expect(await importWorldZip(zip, dir, 'world')).toBe('world-2')
  })
  it('lehnt ZIPs ohne Welt ab', async () => {
    const zip = join(tmp(), 'no.zip')
    await new Promise<void>((res) => { const o = createWriteStream(zip); o.on('close', () => res()); const a = archiver('zip'); a.pipe(o); a.append('x', { name: 'a.txt' }); void a.finalize() })
    await expect(importWorldZip(zip, tmp())).rejects.toThrow(/level\.dat/)
  })
})

describe('Zeitpläne', () => {
  const at = (h: number, m: number, d = 1) => new Date(2026, 0, d, h, m, 0, 0).getTime()
  it('berechnet nächste Termine', () => {
    expect(nextRun({ kind: 'interval', everyMinutes: 30 }, at(10, 0))).toBe(at(10, 30))
    expect(nextRun({ kind: 'daily', time: '04:00' }, at(10, 0))).toBe(at(4, 0, 2))
    expect(nextRun({ kind: 'daily', time: '12:00' }, at(10, 0))).toBe(at(12, 0))
    // 5. Januar 2026 ist ein Montag (1)
    expect(nextRun({ kind: 'weekly', days: [1], time: '03:00' }, at(10, 0, 1))).toBe(at(3, 0, 5))
  })
  it('validiert Eingaben', () => {
    expect(() => validateSpec({ kind: 'daily', time: '25:00' })).toThrow()
    expect(() => validateSpec({ kind: 'interval', everyMinutes: 0 })).toThrow()
    expect(() => validateSpec({ kind: 'weekly', days: [], time: '10:00' })).toThrow()
    expect(() => validateSpec({ kind: 'weekly', days: [7], time: '10:00' })).toThrow()
  })
  it('führt fällige Aufgaben aus, überspringt stark Verspätetes und deaktivierte', async () => {
    let now = at(10, 0)
    const calls: string[] = []
    const s = new Scheduler(join(tmp(), 's.json'), {
      restart: async (id, w) => void calls.push(`restart:${id}:${w}`), backup: async (id) => void calls.push(`backup:${id}`),
      command: (id, c) => void calls.push(`cmd:${id}:${c}`), announce: (id, m) => void calls.push(`say:${id}:${m}`),
    }, () => now)
    const base = { serverId: 's1', enabled: true }
    s.upsert({ ...base, id: 'a', name: 'Backup', spec: { kind: 'interval', everyMinutes: 60 }, action: { type: 'backup' } } as ScheduleTask)
    s.upsert({ ...base, id: 'b', name: 'Restart', spec: { kind: 'daily', time: '04:00' }, action: { type: 'restart', warnSeconds: 60 } } as ScheduleTask)
    s.upsert({ ...base, id: 'c', name: 'Aus', enabled: false, spec: { kind: 'interval', everyMinutes: 1 }, action: { type: 'command', command: 'list' } } as ScheduleTask)
    expect(await s.tick()).toEqual([])
    now = at(11, 0)
    expect(await s.tick()).toEqual(['a'])
    expect(await s.tick()).toEqual([]) // nicht doppelt
    now = at(4, 0, 2)
    await s.tick()
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toContain('backup:s1')
    expect(calls).toContain('restart:s1:60')
    // PC war 5 Stunden aus: Termin wird nicht nachgeholt
    calls.length = 0
    s.upsert({ ...base, id: 'd', name: 'Hint', spec: { kind: 'interval', everyMinutes: 10 }, action: { type: 'announce', message: 'hi' }, lastRun: at(4, 0, 2) } as ScheduleTask)
    now = at(9, 0, 2)
    await s.tick()
    expect(calls.filter((c) => c.startsWith('say'))).toEqual([])
  })
  it('lehnt gefährliche Aufgaben ab', () => {
    const s = new Scheduler(join(tmp(), 's.json'), { restart: async () => {}, backup: async () => {}, command: () => {}, announce: () => {} })
    expect(() => s.upsert({ id: '', serverId: 's', name: 'x', enabled: true, spec: { kind: 'interval', everyMinutes: 5 }, action: { type: 'command', command: 'say a\nstop' } })).toThrow()
    expect(() => s.upsert({ id: '', serverId: 's', name: 'x', enabled: true, spec: { kind: 'interval', everyMinutes: 5 }, action: { type: 'restart', warnSeconds: 99999 } })).toThrow()
  })
})

describe('Leistung', () => {
  it('liest TPS mit und ohne Farbcodes', () => {
    expect(parseTps('[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 19.98, 20.0, 20.0')).toBe(19.98)
    expect(parseTps('§6TPS from last 1m, 5m, 15m: §a*20.0, §a20.0, §a20.0')).toBe(20)
    expect(parseTps('Hallo')).toBeNull()
  })
  it('rechnet CPU-Prozent', () => {
    expect(cpuPercent({ cpuMs: 1000, rssBytes: 0 }, { cpuMs: 3500, rssBytes: 0 }, 5000)).toBe(50)
    expect(cpuPercent({ cpuMs: 0, rssBytes: 0 }, { cpuMs: 10, rssBytes: 0 }, 0)).toBe(0)
  })
  it('hält nur die letzten Messwerte und warnt einmalig bei niedrigen TPS', () => {
    const st = new StatsStore(3)
    for (let i = 0; i < 5; i++) st.push('a', { t: i, cpu: 0, ramMb: 0, players: 0 })
    expect(st.get('a').map((s) => s.t)).toEqual([2, 3, 4])
    const d = new LowTpsDetector(15, 3)
    expect([12, 12, 12, 12, 19, 10, 10, 10].map((v) => d.feed('a', v))).toEqual([false, false, true, false, false, false, false, true])
  })
})

describe('Benachrichtigungen', () => {
  it('erkennt Zustandswechsel und Spieler', () => {
    expect(diffServerEvents(undefined, { status: 'starting', players: [] })).toEqual([])
    expect(diffServerEvents({ status: 'starting', players: [] }, { status: 'running', players: [] })).toEqual([{ type: 'started' }])
    expect(diffServerEvents({ status: 'running', players: ['A'] }, { status: 'running', players: ['B'] })).toEqual([{ type: 'join', player: 'B' }, { type: 'leave', player: 'A' }])
    expect(diffServerEvents({ status: 'running', players: [] }, { status: 'crashed', players: [] })).toEqual([{ type: 'crashed' }])
    expect(diffServerEvents({ status: 'stopping', players: [] }, { status: 'stopped', players: [] })).toEqual([{ type: 'stopped' }])
    expect(diffServerEvents({ status: 'crashed', players: [] }, { status: 'stopped', players: [] })).toEqual([])
  })
  it('akzeptiert nur echte Discord-Webhooks', async () => {
    expect(isDiscordWebhook('https://discord.com/api/webhooks/123456/abc-DEF_1')).toBe(true)
    for (const bad of ['http://discord.com/api/webhooks/1/a', 'https://evil.com/api/webhooks/1/a', 'https://discord.com.evil.com/api/webhooks/1/a', 'https://discord.com/other', 'x']) expect(isDiscordWebhook(bad), bad).toBe(false)
    await expect(sendDiscord('https://evil.com/x', {})).rejects.toThrow(/gültige/)
    let body = ''
    await sendDiscord('https://discord.com/api/webhooks/1/a', { a: 1 }, (async (_u: unknown, i?: RequestInit) => { body = String(i?.body); return new Response(null, { status: 204 }) }) as typeof fetch)
    expect(body).toBe('{"a":1}')
  })
  it('verhindert @everyone-Erwähnungen', () => {
    const p = discordPayload('S', { type: 'join', player: '@everyone' })
    expect(p.allowed_mentions.parse).toEqual([])
  })
})
