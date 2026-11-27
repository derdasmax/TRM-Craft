import extract from 'extract-zip'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
  new Promise<void>((ok, fail) => execFile(cmd, args, { windowsHide: true, timeout: 300_000, maxBuffer: 8 * 1024 * 1024, env }, (e, _o, err) => (e ? fail(new Error(String(err).trim().split('\n')[0] || e.message)) : ok())))

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
    let tarError = ''
    try {
      await run('tar.exe', ['-xf', zip, '-C', target])
      return
    } catch (e) { tarError = (e as Error).message }
    try {
      // Pfade über die Umgebung: Mit `-Command` kommen Argumente nicht in `$args` an.
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:TRM_ZIP -DestinationPath $env:TRM_DEST -Force'], { ...process.env, TRM_ZIP: zip, TRM_DEST: target })
      return
    } catch (second) {
      throw new Error(`${(first as Error).message} (tar: ${tarError}; PowerShell: ${(second as Error).message})`)
    }
  }
}
