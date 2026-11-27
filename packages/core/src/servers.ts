import { z } from 'zod'

export const SERVER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const LOADERS = ['bedrock', 'paper', 'purpur', 'folia', 'spigot', 'vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'velocity', 'waterfall', 'bungeecord'] as const
export const LoaderSchema = z.enum(LOADERS)
export type Loader = z.infer<typeof LoaderSchema>

export interface LoaderInfo {
  label: string
  edition: 'java' | 'bedrock'
  group: 'server' | 'mods' | 'proxy' | 'bedrock'
  /** Braucht eine Java-Laufzeit (Bedrock ist ein natives Programm). */
  java: boolean
  /** Spieler verbinden sich per UDP (Bedrock) statt TCP. */
  udp?: boolean
  /** Kann mit Geyser/Floodgate für Bedrock-Spieler geöffnet werden. */
  crossplay?: boolean
  /** Ordner für Erweiterungen (Plugins oder Mods). */
  extFolder: 'plugins' | 'mods' | null
  /** Proxys haben weder EULA noch server.properties. */
  proxy: boolean
  /** Standard-Port, falls vom Minecraft-Standard abweichend. */
  defaultPort?: number
}

export const LOADER_INFO: Record<Loader, LoaderInfo> = {
  bedrock: { label: 'Bedrock', edition: 'bedrock', java: false, udp: true, group: 'bedrock', extFolder: null, proxy: false, defaultPort: 19132 },
  paper: { label: 'Paper', edition: 'java', java: true, crossplay: true, group: 'server', extFolder: 'plugins', proxy: false },
  purpur: { label: 'Purpur', edition: 'java', java: true, crossplay: true, group: 'server', extFolder: 'plugins', proxy: false },
  folia: { label: 'Folia', edition: 'java', java: true, crossplay: true, group: 'server', extFolder: 'plugins', proxy: false },
  spigot: { label: 'Spigot', edition: 'java', java: true, crossplay: true, group: 'server', extFolder: 'plugins', proxy: false },
  vanilla: { label: 'Vanilla', edition: 'java', java: true, group: 'server', extFolder: null, proxy: false },
  fabric: { label: 'Fabric', edition: 'java', java: true, group: 'mods', extFolder: 'mods', proxy: false },
  quilt: { label: 'Quilt', edition: 'java', java: true, group: 'mods', extFolder: 'mods', proxy: false },
  forge: { label: 'Forge', edition: 'java', java: true, group: 'mods', extFolder: 'mods', proxy: false },
  neoforge: { label: 'NeoForge', edition: 'java', java: true, group: 'mods', extFolder: 'mods', proxy: false },
  velocity: { label: 'Velocity', edition: 'java', java: true, group: 'proxy', extFolder: 'plugins', proxy: true, defaultPort: 25577 },
  waterfall: { label: 'Waterfall', edition: 'java', java: true, group: 'proxy', extFolder: 'plugins', proxy: true, defaultPort: 25577 },
  bungeecord: { label: 'BungeeCord', edition: 'java', java: true, group: 'proxy', extFolder: 'plugins', proxy: true, defaultPort: 25577 },
}

/** Wie der Server gestartet wird: direkt per JAR oder über eine Argument-Datei (moderne Forge/NeoForge). */
export const LaunchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('jar'), jar: z.string() }),
  /** `{platform}` wird zu `win` bzw. `unix`. */
  z.object({ type: z.literal('args'), argsFile: z.string() }),
  /** Natives Programm (Bedrock Dedicated Server). */
  z.object({ type: z.literal('exe'), exe: z.string() }),
])
export type Launch = z.infer<typeof LaunchSchema>

export const JvmPresetSchema = z.enum(['none', 'aikar'])

export const ServerRecordSchema = z.object({
  id: z.string().regex(SERVER_ID),
  name: z.string().trim().min(1).max(40),
  edition: z.enum(['java', 'bedrock']).default('java'),
  loader: LoaderSchema,
  mcVersion: z.string().min(1),
  /** Konkreter Build (z. B. Paper-Build), falls vorhanden. */
  build: z.string().optional(),
  port: z.number().int().min(1024).max(65535),
  ramMb: z.number().int().min(512).max(131072),
  jvmPreset: JvmPresetSchema.default('aikar'),
  javaMajor: z.number().int().min(8).max(99).optional(),
  launch: LaunchSchema.default({ type: 'jar', jar: 'server.jar' }),
  /** Geyser + Floodgate sind installiert, damit Bedrock-Spieler joinen können. */
  crossplay: z.boolean().default(false),
  /** UDP-Port für Bedrock-Spieler bei Crossplay. */
  bedrockPort: z.number().int().min(1024).max(65535).optional(),
  backup: z.object({ dir: z.string().optional(), keep: z.number().int().min(1).max(200).default(10) }).default({}),
  notify: z.object({ desktop: z.boolean().default(true), discord: z.boolean().default(false), joins: z.boolean().default(false) }).default({}),
  /** Ressourcenlimits: CPU-Kerne (JVM) und Prozess-Priorität. */
  limits: z.object({ cores: z.number().int().min(1).max(64).optional(), priority: z.enum(['low', 'normal', 'high']).default('normal') }).default({}),
  autoRestart: z.boolean().default(true),
  /** Wird nach App-Start (und nach einem Update) automatisch gestartet. */
  autostart: z.boolean().default(false),
  /** ISO-Zeitpunkt, an dem der Nutzer die EULA aktiv akzeptiert hat. */
  eulaAcceptedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ServerRecord = z.infer<typeof ServerRecordSchema>

export const CreateServerInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  loader: LoaderSchema,
  mcVersion: z.string().min(1),
  port: z.number().int().min(1024).max(65535).optional(),
  ramMb: z.number().int().min(512).max(131072),
  /** Muss `true` sein: Die EULA wird nie automatisch akzeptiert. */
  acceptEula: z.literal(true),
  motd: z.string().max(200).optional(),
  seed: z.string().max(100).optional(),
  gamemode: z.enum(['survival', 'creative', 'adventure']).optional(),
  difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']).optional(),
  maxPlayers: z.number().int().min(1).max(1000).optional(),
  /** Fest vorgegebene Loader-Version (z. B. aus einem Modpack). */
  loaderVersion: z.string().max(60).regex(/^[\w.+-]+$/).optional(),
  /** Java-Server zusätzlich für Bedrock-Spieler öffnen (Geyser + Floodgate). */
  crossplay: z.boolean().optional(),
  /** Quelle der Welt: leer = neue Welt. */
  worldZip: z.string().optional(),
})
export type CreateServerInput = z.infer<typeof CreateServerInputSchema>

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

export interface ServerView extends ServerRecord {
  status: ServerStatus
  players: string[]
  startedAt: number | null
  /** Anzahl automatischer Neustarts im aktuellen Fenster. */
  restarts: number
  lastCrash?: CrashReport
}

export interface CrashReport {
  /** Maschinenlesbarer Typ, z. B. "port-in-use". */
  kind: string
  /** Verständliche Erklärung auf Deutsch. */
  message: string
  hint?: string
}

export interface VersionInfo {
  id: string
  type: 'release' | 'snapshot'
}

export interface ProgressEvent {
  token: string
  label: string
  /** 0-100, oder null bei unbestimmtem Fortschritt. */
  percent: number | null
}

export interface LogEvent {
  id: string
  line: string
}

/** Auslastung des ganzen PCs (Titelleiste). */
export interface SystemUsage {
  /** 0–100 */
  cpu: number
  ramUsedMb: number
  ramTotalMb: number
}

export interface SystemMemory {
  totalMb: number
  freeMb: number
}

/** Empfohlene RAM-Zuteilung anhand des Gesamtspeichers (Rest bleibt für Windows und andere Programme). */
export function recommendRamMb(totalMb: number): number {
  const usable = Math.floor(totalMb * 0.5)
  const stepped = Math.floor(usable / 512) * 512
  return Math.max(1024, Math.min(stepped, 16384))
}

export const ImportServerInputSchema = z.object({
  /** Absoluter Pfad eines vorhandenen Server-Ordners. */
  path: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(40),
  loader: LoaderSchema,
  mcVersion: z.string().min(1),
  ramMb: z.number().int().min(512).max(131072),
  acceptEula: z.literal(true),
})
export type ImportServerInput = z.infer<typeof ImportServerInputSchema>

export interface SoftwareStatus {
  /** Kann diese Server-Software per Klick aktualisiert werden? */
  supported: boolean
  current?: string
  latest?: string
  available: boolean
  reason?: string
}
