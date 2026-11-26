import { spawn } from 'node:child_process'

export interface RunInstallerOptions {
  java: string
  args: string[]
  cwd: string
  onLine?: (line: string) => void
  timeoutMs?: number
}

export type InstallerRunner = (o: RunInstallerOptions) => Promise<void>

/** Startet ein Java-Programm (Forge-Installer, BuildTools, ...) und streamt seine Ausgabe. */
export const runInstaller: InstallerRunner = ({ java, args, cwd, onLine, timeoutMs = 15 * 60_000 }) =>
  new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd, windowsHide: true })
    let tail: string[] = []
    const feed = (d: Buffer) => {
      for (const line of d.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        tail = [...tail.slice(-19), line]
        onLine?.(line)
      }
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Die Installation hat zu lange gedauert.')) }, timeoutMs)
    child.once('error', (e) => { clearTimeout(timer); reject(e) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Installation fehlgeschlagen (Code ${code}). ${tail.slice(-3).join(' | ')}`))
    })
  })
