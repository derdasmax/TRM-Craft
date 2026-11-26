import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOADER_INFO, type Launch, type Loader, type VersionInfo } from '@trm/core'
import { downloadFile, type FetchLike } from './download'
import type { InstallerRunner } from './installer'
import { javaForMinecraft } from './providers/adoptium'
import { listMetaGameVersions, resolveFabric, resolveQuilt } from './providers/fabric'
import { listForgeVersions, listNeoForgeVersions, resolveForge, resolveNeoForge } from './providers/forge'
import { fetchManifest, listFromManifest, resolveVanilla } from './providers/mojang'
import { resolveBedrock } from './providers/bedrock'
import { geyserConfig, resolveGeyser } from './providers/geyser'
import { listPaperVersions, resolvePaperBuild } from './providers/paper'
import { listPurpurVersions, resolvePurpur } from './providers/purpur'

export interface InstallCtx {
  dir: string
  version: string
  loaderVersion?: string
  java: string
  platform: NodeJS.Platform
  fetchImpl?: FetchLike
  download: typeof downloadFile
  run: InstallerRunner
  extract: (zip: string, dir: string) => Promise<void>
  progress: (label: string, percent: number | null) => void
}

export interface InstallResult {
  build?: string
  launch: Launch
}

export interface LoaderDef {
  versions(f?: FetchLike): Promise<VersionInfo[]>
  /** Benötigte Java-Hauptversion. */
  javaMajor(version: string, f?: FetchLike): Promise<number>
  install(ctx: InstallCtx): Promise<InstallResult>
  /** Neuester verfügbarer Build bzw. Loader für diese Version (nur für JAR-basierte Software, die sich ersetzen lässt). */
  latest?(version: string, f?: FetchLike): Promise<string | undefined>
}

const JAR: Launch = { type: 'jar', jar: 'server.jar' }
const mcJava = async (mc: string, f?: FetchLike) => (await resolveVanilla(mc, f).then((r) => r.javaMajor).catch(() => null)) ?? javaForMinecraft(mc)
const dlProgress = (c: InstallCtx, label: string) => (d: number, t: number | null) => c.progress(label, t ? Math.round((d / t) * 100) : null)
const mcVersions = async (f?: FetchLike) => listFromManifest(await fetchManifest(f))

function findJar(dir: string, pick: (name: string) => boolean): string | null {
  if (!existsSync(dir)) return null
  return readdirSync(dir).find((n) => n.endsWith('.jar') && pick(n)) ?? null
}

/** Findet nach einem Forge/NeoForge-Installer, wie der Server gestartet wird. */
export function detectForgeLaunch(dir: string, group: string, artifactVersion: string): Launch {
  const libDir = join(dir, 'libraries', ...group.split('/'), artifactVersion)
  if (existsSync(join(libDir, 'win_args.txt')) || existsSync(join(libDir, 'unix_args.txt')))
    return { type: 'args', argsFile: `libraries/${group}/${artifactVersion}/{platform}_args.txt` }
  const jar = findJar(dir, (n) => /^forge-/.test(n) && !/installer/.test(n))
  if (!jar) throw new Error('Nach der Installation wurde keine Forge-Startdatei gefunden.')
  return { type: 'jar', jar }
}

const paperLike = (project: string): LoaderDef => ({
  versions: (f) => listPaperVersions(project, f),
  javaMajor: (v, f) => (project === 'velocity' || project === 'waterfall' ? Promise.resolve(21) : mcJava(v, f)),
  latest: async (v, f) => (await resolvePaperBuild(v, project, f)).build,
  async install(c) {
    const b = await resolvePaperBuild(c.version, project, c.fetchImpl)
    await c.download({ url: b.url, dest: join(c.dir, 'server.jar'), sha256: b.sha256, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Server-Software wird geladen …') })
    return { build: b.build, launch: JAR }
  },
})

/** Installiert Geyser und Floodgate, damit Bedrock-Spieler (Handy, Konsole, Windows) einem Java-Server beitreten können. */
export async function installCrossplay(c: Pick<InstallCtx, 'dir' | 'fetchImpl' | 'download' | 'progress'>, javaPort: number, bedrockPort: number): Promise<void> {
  const plugins = join(c.dir, 'plugins')
  mkdirSync(plugins, { recursive: true })
  for (const project of ['geyser', 'floodgate'] as const) {
    const r = await resolveGeyser(project, c.fetchImpl)
    await c.download({ url: r.url, dest: join(plugins, `${project === 'geyser' ? 'Geyser' : 'floodgate'}-Spigot.jar`), sha256: r.sha256, fetchImpl: c.fetchImpl, onProgress: dlProgress(c as InstallCtx, `${project === 'geyser' ? 'Geyser' : 'Floodgate'} wird geladen …`) })
  }
  mkdirSync(join(plugins, 'Geyser-Spigot'), { recursive: true })
  writeFileSync(join(plugins, 'Geyser-Spigot', 'config.yml'), geyserConfig(bedrockPort, javaPort))
}

export const LOADER_DEFS: Record<Loader, LoaderDef> = {
  bedrock: {
    // Mojang veröffentlicht nur die jeweils aktuelle Version zum Download.
    versions: async (f) => [{ id: (await resolveBedrock(f)).version, type: 'release' }],
    javaMajor: async () => 0,
    async install(c) {
      const b = await resolveBedrock(c.fetchImpl)
      const zip = join(c.dir, 'bedrock-server.zip')
      await c.download({ url: b.url, dest: zip, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Bedrock-Server wird geladen …') })
      c.progress('Bedrock-Server wird entpackt …', null)
      await c.extract(zip, c.dir)
      rmSync(zip, { force: true })
      if (!existsSync(join(c.dir, 'bedrock_server.exe'))) throw new Error('bedrock_server.exe fehlt im Download.')
      return { build: b.version, launch: { type: 'exe', exe: 'bedrock_server.exe' } }
    },
  },
  vanilla: {
    versions: mcVersions,
    javaMajor: mcJava,
    async install(c) {
      const v = await resolveVanilla(c.version, c.fetchImpl)
      await c.download({ url: v.url, dest: join(c.dir, 'server.jar'), sha1: v.sha1, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Server-Software wird geladen …') })
      return { launch: JAR }
    },
  },
  paper: paperLike('paper'),
  folia: paperLike('folia'),
  velocity: paperLike('velocity'),
  waterfall: paperLike('waterfall'),
  purpur: {
    versions: listPurpurVersions,
    javaMajor: mcJava,
    latest: async (v, f) => (await resolvePurpur(v, f)).build,
    async install(c) {
      const b = await resolvePurpur(c.version, c.fetchImpl)
      await c.download({ url: b.url, dest: join(c.dir, 'server.jar'), md5: b.md5, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Server-Software wird geladen …') })
      return { build: b.build, launch: JAR }
    },
  },
  spigot: {
    versions: mcVersions,
    javaMajor: mcJava,
    async install(c) {
      // Spigot wird aus dem Quellcode gebaut (BuildTools). Das dauert einige Minuten.
      const work = join(c.dir, '.buildtools')
      mkdirSync(work, { recursive: true })
      await c.download({ url: 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar', dest: join(work, 'BuildTools.jar'), fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'BuildTools wird geladen …') })
      c.progress('Spigot wird gebaut (das dauert einige Minuten) …', null)
      await c.run({ java: c.java, args: ['-jar', 'BuildTools.jar', '--rev', c.version, '--output-dir', '..'], cwd: work, onLine: (l) => c.progress(`Spigot wird gebaut: ${l.slice(0, 80)}`, null), timeoutMs: 30 * 60_000 })
      const jar = findJar(c.dir, (n) => /^spigot-.*\.jar$/.test(n))
      if (!jar) throw new Error('BuildTools hat kein Spigot-JAR erzeugt.')
      renameSync(join(c.dir, jar), join(c.dir, 'server.jar'))
      rmSync(work, { recursive: true, force: true })
      return { launch: JAR }
    },
  },
  fabric: {
    versions: (f) => listMetaGameVersions('fabric', f),
    javaMajor: mcJava,
    latest: async (v, f) => (await resolveFabric(v, f)).loader,
    async install(c) {
      const r = await resolveFabric(c.version, c.fetchImpl, c.loaderVersion)
      await c.download({ url: r.url, dest: join(c.dir, 'server.jar'), fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Fabric wird geladen …') })
      return { build: r.loader, launch: JAR }
    },
  },
  quilt: {
    versions: (f) => listMetaGameVersions('quilt', f),
    javaMajor: mcJava,
    async install(c) {
      const q = await resolveQuilt(c.fetchImpl)
      const installer = join(c.dir, 'quilt-installer.jar')
      await c.download({ url: q.installerUrl, dest: installer, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Quilt-Installer wird geladen …') })
      c.progress('Quilt wird installiert …', null)
      await c.run({ java: c.java, args: ['-jar', 'quilt-installer.jar', 'install', 'server', c.version, '--download-server', `--install-dir=${c.dir}`, ...(c.loaderVersion ? [`--loader-version=${c.loaderVersion}`] : [])], cwd: c.dir, onLine: (l) => c.progress(`Quilt: ${l.slice(0, 80)}`, null) })
      rmSync(installer, { force: true })
      const jar = findJar(c.dir, (n) => n === 'quilt-server-launch.jar')
      if (!jar) throw new Error('Quilt-Startdatei wurde nicht gefunden.')
      return { launch: { type: 'jar', jar } }
    },
  },
  forge: {
    versions: listForgeVersions,
    javaMajor: mcJava,
    async install(c) {
      const r = await resolveForge(c.version, c.fetchImpl, c.loaderVersion)
      const installer = join(c.dir, 'forge-installer.jar')
      await c.download({ url: r.installerUrl, dest: installer, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'Forge-Installer wird geladen …') })
      c.progress('Forge wird installiert (das dauert etwas) …', null)
      await c.run({ java: c.java, args: ['-jar', 'forge-installer.jar', '--installServer'], cwd: c.dir, onLine: (l) => c.progress(`Forge: ${l.slice(0, 80)}`, null) })
      rmSync(installer, { force: true })
      return { build: r.forgeVersion, launch: detectForgeLaunch(c.dir, 'net/minecraftforge/forge', `${c.version}-${r.forgeVersion}`) }
    },
  },
  neoforge: {
    versions: listNeoForgeVersions,
    javaMajor: mcJava,
    async install(c) {
      const r = await resolveNeoForge(c.version, c.fetchImpl, c.loaderVersion)
      const installer = join(c.dir, 'neoforge-installer.jar')
      await c.download({ url: r.installerUrl, dest: installer, fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'NeoForge-Installer wird geladen …') })
      c.progress('NeoForge wird installiert (das dauert etwas) …', null)
      await c.run({ java: c.java, args: ['-jar', 'neoforge-installer.jar', '--installServer'], cwd: c.dir, onLine: (l) => c.progress(`NeoForge: ${l.slice(0, 80)}`, null) })
      rmSync(installer, { force: true })
      return { build: r.neoVersion, launch: detectForgeLaunch(c.dir, 'net/neoforged/neoforge', r.neoVersion) }
    },
  },
  bungeecord: {
    versions: async () => [{ id: 'latest', type: 'release' }],
    javaMajor: async () => 21,
    async install(c) {
      await c.download({ url: 'https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar', dest: join(c.dir, 'server.jar'), fetchImpl: c.fetchImpl, onProgress: dlProgress(c, 'BungeeCord wird geladen …') })
      return { launch: JAR }
    },
  },
}

export const isProxy = (l: Loader) => LOADER_INFO[l].proxy
