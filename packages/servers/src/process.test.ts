import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseLogLine, ServerProcess } from './process'

const fake = fileURLToPath(new URL('../test/fake-server.mjs', import.meta.url))
const spec = (env: NodeJS.ProcessEnv = {}) => ({ command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, ...env } })
const until = (p: ServerProcess, status: string) => new Promise<void>((r) => (p.status === status ? r() : p.on('status', (s) => s === status && r())))

describe('parseLogLine', () => {
  it('erkennt Done, Join und Leave', () => {
    expect(parseLogLine('[12:00:00] [Server thread/INFO]: Done (3.214s)! For help, type "help"')).toEqual({ type: 'done' })
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: Steve joined the game')).toEqual({ type: 'join', name: 'Steve' })
    expect(parseLogLine('[12:00:02] [Server thread/INFO]: .BedrockSam left the game')).toEqual({ type: 'leave', name: '.BedrockSam' })
    expect(parseLogLine('[19:02:11 INFO]: Done (3.11s)!')).toEqual({ type: 'done' })
    expect(parseLogLine('12:00:00 [INFO] Listening on /0.0.0.0:25577')).toEqual({ type: 'done' })
    expect(parseLogLine('[2025-01-01 12:00:00:000 INFO] Server started.')).toEqual({ type: 'done' })
    expect(parseLogLine('[2025-01-01 12:00:01:000 INFO] Player connected: Steve Smith, xuid: 2535')).toEqual({ type: 'join', name: 'Steve Smith' })
    expect(parseLogLine('[2025-01-01 12:00:02:000 INFO] Player disconnected: Steve Smith, xuid: 2535')).toEqual({ type: 'leave', name: 'Steve Smith' })
    expect(parseLogLine('[12:00:03] [Server thread/INFO]: <Steve> Steve joined the game')).toBeNull()
  })
})

describe('ServerProcess', () => {
  it('startet, trackt Spieler und stoppt sauber', async () => {
    const p = new ServerProcess()
    const lines: string[] = []
    p.on('line', (l) => lines.push(l))
    p.start(spec())
    expect(p.status).toBe('starting')
    await until(p, 'running')
    p.send('join Steve')
    await new Promise((r) => setTimeout(r, 100))
    expect([...p.players]).toEqual(['Steve'])
    await p.stop(5000)
    expect(p.status).toBe('stopped')
    expect(lines.some((l) => l.includes('Stopping the server'))).toBe(true)
  })
  it('erkennt einen Absturz', async () => {
    const p = new ServerProcess()
    const exit = new Promise<{ crashed: boolean }>((r) => p.on('exit', r))
    p.start(spec())
    await until(p, 'running')
    p.send('crash')
    expect((await exit).crashed).toBe(true)
    expect(p.status).toBe('crashed')
  })
  it('wertet Kill als gewolltes Ende', async () => {
    const p = new ServerProcess()
    p.start(spec())
    await until(p, 'running')
    await p.kill()
    expect(p.status).toBe('stopped')
  })
  it('lehnt Befehle mit Zeilenumbruch ab', async () => {
    const p = new ServerProcess()
    p.start(spec())
    expect(() => p.send('say a\nop evil')).toThrow()
    await p.kill()
  })
})
