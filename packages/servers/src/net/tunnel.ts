import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { TunnelState } from '@trm/core'
import { downloadFile, fetchJson, type FetchLike } from '../download'

const ReleaseSchema = z.object({ assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url(), digest: z.string().nullable().optional() })) })

/** Wählt die Windows-x64-Datei des playit-Agenten (signierte Variante bevorzugt). */
export function pickPlayitAsset(assets: { name: string; browser_download_url: string; digest?: string | null }[]) {
  const win = assets.filter((a) => /windows.*(x86_64|amd64).*\.exe$/i.test(a.name) && !/\.sig$/i.test(a.name))
  const a = win.find((x) => /signed/i.test(x.name)) ?? win[0]
  if (!a) return null
  const sha = /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? '')?.[1]
  return { name: a.name, url: a.browser_download_url, sha256: sha }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[\d;]*[A-Za-z]/g
/** Liest den Link zum Verbinden mit dem playit.gg-Konto. Nur Links auf playit.gg werden akzeptiert. */
export function parseClaimUrl(line: string): string | undefined {
  const m = /https:\/\/(?:www\.)?playit\.gg\/[^\s"'<>]+/.exec(line.replace(ANSI, ''))
  return m?.[0]
}

export interface TunnelDeps {
  dir: string
  emit: (s: TunnelState) => void
  fetchImpl?: FetchLike
  download?: typeof downloadFile
  /** Nur für Tests. */
  command?: (exe: string) => { cmd: string; args: string[] }
}

export class PlayitTunnel {
  private child: ChildProcessWithoutNullStreams | null = null
  private s: TunnelState = { status: 'stopped', lines: [] }
  constructor(private readonly d: TunnelDeps) {}

  get state(): TunnelState { return this.s }
  private set(p: Partial<TunnelState>) { this.s = { ...this.s, ...p }; this.d.emit(this.s) }

  async start(): Promise<void> {
    if (this.child) return
    const exe = join(this.d.dir, 'playit.exe')
    try {
      if (!existsSync(exe) && !this.d.command) {
        this.set({ status: 'downloading', lines: [], error: undefined, claimUrl: undefined })
        const rel = ReleaseSchema.parse(await fetchJson('https://api.github.com/repos/playit-cloud/playit-agent/releases/latest', this.d.fetchImpl))
        const asset = pickPlayitAsset(rel.assets)
        if (!asset) throw new Error('Für Windows wurde kein playit-Agent gefunden.')
        mkdirSync(this.d.dir, { recursive: true })
        await (this.d.download ?? downloadFile)({ url: asset.url, dest: exe, sha256: asset.sha256, fetchImpl: this.d.fetchImpl })
        try { chmodSync(exe, 0o755) } catch { /* Windows */ }
      }
      this.set({ status: 'starting', lines: [], error: undefined, claimUrl: undefined })
      const { cmd, args } = this.d.command?.(exe) ?? { cmd: exe, args: [] }
      const child = spawn(cmd, args, { cwd: this.d.dir, windowsHide: true })
      this.child = child
      const feed = (b: Buffer) => {
        for (const raw of b.toString('utf8').split(/\r?\n/)) {
          const line = raw.replace(ANSI, '').trim()
          if (!line) continue
          const claim = parseClaimUrl(line)
          this.set({ lines: [...this.s.lines.slice(-49), line], claimUrl: claim ?? this.s.claimUrl, status: /tunnel running|connected|agent.*running/i.test(line) ? 'running' : this.s.status })
        }
      }
      child.stdout.on('data', feed)
      child.stderr.on('data', feed)
      child.once('error', (e) => { this.child = null; this.set({ status: 'error', error: e.message }) })
      child.once('close', (code) => { this.child = null; this.set(this.s.status === 'error' ? {} : { status: 'stopped', error: code ? `Der Agent wurde beendet (Code ${code}).` : undefined }) })
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.set({ status: 'stopped' })
  }
}
