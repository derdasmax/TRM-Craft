import extract from 'extract-zip'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const run = (cmd: string, args: string[]) =>
  new Promise<void>((ok, fail) => execFile(cmd, args, { windowsHide: true, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }, (e, _o, err) => (e ? fail(new Error(String(err).trim() || e.message)) : ok())))

/**
 * Entpackt ein ZIP aus einer **vertrauenswürdigen, geprüften Quelle** (Java, Server-Software).
 * Zuerst `extract-zip`. Meldet es einen kaputten ZIP-Abschluss (z. B. „invalid comment length“, wenn Daten am Ende angehängt sind),
 * folgen unter Windows `tar.exe` und PowerShell, die damit umgehen können.
 * Nutzerdateien (Backups, Datei-Manager) laufen weiter nur über `extract-zip`, das Zip-Slip verhindert.
 */
export async function extractTrusted(zip: string, dir: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const target = resolve(dir)
  try {
    await extract(zip, { dir: target })
    return
  } catch (first) {
    if (platform !== 'win32') throw first
    mkdirSync(target, { recursive: true })
    try {
      await run('tar.exe', ['-xf', zip, '-C', target])
      return
    } catch { /* weiter mit PowerShell */ }
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', zip, target])
      return
    } catch (second) {
      throw new Error(`${(first as Error).message} (Ersatz-Entpacker: ${(second as Error).message})`)
    }
  }
}
