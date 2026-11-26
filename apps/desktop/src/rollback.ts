import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { RELEASE_BASE } from './release-config'
import { parseUpdateYml } from './update-yml'

async function fetchText(url: string): Promise<string | null> {
  const res = await net.fetch(url)
  return res.ok ? res.text() : null
}

/**
 * Lädt den Installer der letzten guten Version aus dem GitHub-Release, prüft SHA-512
 * und installiert ihn still. Wirft bei jedem Fehler, damit der Aufrufer weiterlaufen kann.
 */
export async function rollbackTo(version: string): Promise<void> {
  const base = `${RELEASE_BASE}/v${version}`
  const ymlText = (await fetchText(`${base}/latest.yml`)) ?? (await fetchText(`${base}/beta.yml`))
  const meta = ymlText ? parseUpdateYml(ymlText) : null
  if (!meta) throw new Error(`Keine Update-Metadaten für ${version}`)

  const dir = join(app.getPath('temp'), 'trm-craft-rollback')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, meta.path)

  const res = await net.fetch(`${base}/${encodeURIComponent(meta.path)}`)
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`)
  const hash = createHash('sha512')
  const out = createWriteStream(target)
  const src = Readable.fromWeb(res.body as never)
  src.on('data', (c) => hash.update(c))
  await pipeline(src, out)
  if (hash.digest('base64') !== meta.sha512) throw new Error('Prüfsumme stimmt nicht überein')

  // /S = still. Der Installer schließt die laufende App selbst.
  spawn(target, ['/S'], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}
