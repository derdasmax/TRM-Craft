import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type FetchLike = typeof fetch

export interface DownloadOptions {
  url: string
  dest: string
  md5?: string
  sha1?: string
  sha256?: string
  sha512?: string
  onProgress?: (done: number, total: number | null) => void
  fetchImpl?: FetchLike
}

/** Erlaubte Download-Hosts (nur offizielle Quellen). Tests nutzen `allowHost`. */
const ALLOWED = [
  'piston-data.mojang.com', 'piston-meta.mojang.com', 'launcher.mojang.com', 'libraries.minecraft.net',
  'fill.papermc.io', 'fill-data.papermc.io', 'api.papermc.io', 'github.com', 'objects.githubusercontent.com',
  'release-assets.githubusercontent.com', 'api.adoptium.net', 'meta.fabricmc.net', 'maven.fabricmc.net',
  'maven.neoforged.net', 'maven.minecraftforge.net', 'files.minecraftforge.net', 'cdn.modrinth.com',
  'api.modrinth.com', 'www.minecraft.net', 'minecraft.azureedge.net', 'cdn.azul.com', 'download.geysermc.org',
  'api.purpurmc.org', 'repo.papermc.io', 'hub.spigotmc.org', 'api.cloudflare.com', 'ci.md-5.net', 'api.ipify.org', 'api.mcsrvstat.us', 'api.github.com', 'hangar.papermc.io', 'api.curseforge.com', 'edge.forgecdn.net', 'mediafilez.forgecdn.net', 'raw.githubusercontent.com', 'gitlab.com', 'net-secondary.web.minecraft-services.net', 'meta.quiltmc.org', 'maven.quiltmc.org',
]
const extraHosts = new Set<string>()
export const allowHost = (h: string) => extraHosts.add(h)

export function assertAllowedUrl(url: string): URL {
  const u = new URL(url)
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  if (u.protocol !== 'https:' && !(local && extraHosts.has(u.host))) throw new Error(`Nur https erlaubt: ${url}`)
  if (!ALLOWED.includes(u.hostname) && !extraHosts.has(u.host)) throw new Error(`Host nicht erlaubt: ${u.hostname}`)
  return u
}

/** Lädt eine Datei atomar (Temp-Datei + Rename) und prüft optional die Prüfsumme. */
export async function downloadFile(o: DownloadOptions): Promise<void> {
  assertAllowedUrl(o.url)
  const f = o.fetchImpl ?? fetch
  const res = await f(o.url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}): ${o.url}`)
  // Redirect-Ziel erneut prüfen
  if (res.url) assertAllowedUrl(res.url)
  const total = Number(res.headers.get('content-length')) || null
  mkdirSync(dirname(o.dest), { recursive: true })
  const tmp = `${o.dest}.part`
  const algos = (['md5', 'sha1', 'sha256', 'sha512'] as const).filter((a) => o[a])
  const hashes = algos.map((a) => ({ a, h: createHash(a) }))
  let done = 0
  const src = Readable.fromWeb(res.body as never)
  src.on('data', (c: Buffer) => {
    done += c.length
    for (const { h } of hashes) h.update(c)
    o.onProgress?.(done, total)
  })
  try {
    await pipeline(src, createWriteStream(tmp))
    for (const { a, h } of hashes) {
      const got = h.digest('hex')
      const want = o[a]!.toLowerCase()
      if (got !== want && Buffer.from(got, 'hex').toString('base64') !== o[a]) throw new Error(`Prüfsumme (${a}) stimmt nicht überein`)
    }
    renameSync(tmp, o.dest)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

export async function fetchJson<T>(url: string, fetchImpl: FetchLike = fetch): Promise<T> {
  assertAllowedUrl(url)
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'TRM-Craft' } })
  if (!res.ok) throw new Error(`Anfrage fehlgeschlagen (${res.status}): ${url}`)
  return (await res.json()) as T
}
