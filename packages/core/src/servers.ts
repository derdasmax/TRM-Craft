import { z } from 'zod'

export const SERVER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const LOADERS = ['paper', 'purpur', 'folia', 'spigot', 'vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'velocity', 'waterfall', 'bungeecord'] as const
export const LoaderSchema = z.enum(LOADERS)
export type Loader = z.infer<typeof LoaderSchema>

export interface LoaderInfo {
  label: string
  group: 'server' | 'mods' | 'proxy'
  /** Ordner für Erweiterungen (Plugins oder Mods). */
  extFolder: 'plugins' | 'mods' | null
  /** Proxys haben weder EULA noch server.properties. */
  proxy: boolean
  /** Standard-Port, falls vom Minecraft-Standard abweichend. */
  defaultPort?: number
}

export const LOADER_INFO: Record<Loader, LoaderInfo> = {
  paper: { label: 'Paper', group: 'server', extFolder: 'plugins', proxy: false },
  purpur: { label: 'Purpur', group: 'server', extFolder: 'plugins', proxy: false },
  folia: { label: 'Folia', group: 'server', extFolder: 'plugins', proxy: false },
  spigot: { label: 'Spigot', group: 'server', extFolder: 'plugins', proxy: false },
  vanilla: { label: 'Vanilla', group: 'server', extFolder: null, proxy: false },
  fabric: { label: 'Fabric', group: 'mods', extFolder: 'mods', proxy: false },
  quilt: { label: 'Quilt', group: 'mods', extFolder: 'mods', proxy: false },
  forge: { label: 'Forge', group: 'mods', extFolder: 'mods', proxy: false },
  neoforge: { label: 'NeoForge', group: 'mods', extFolder: 'mods', proxy: false },
  velocity: { label: 'Velocity', group: 'proxy', extFolder: 'plugins', proxy: true, defaultPort: 25577 },
  waterfall: { label: 'Waterfall', group: 'proxy', extFolder: 'plugins', proxy: true, defaultPort: 25577 },
  bungeecord: { label: 'BungeeCord', group: 'proxy', extFolder: 'plugins', proxy: true, defaultPort: 25577 },
}

/** Wie der Server gestartet wird: direkt per JAR oder über eine Argument-Datei (moderne Forge/NeoForge). */
export const LaunchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('jar'), jar: z.string() }),
  /** `{platform}` wird zu `win` bzw. `unix`. */
  z.object({ type: z.literal('args'), argsFile: z.string() }),
])
export type Launch = z.infer<typeof LaunchSchema>

export const JvmPresetSchema = z.enum(['none', 'aikar'])

export const ServerRecordSchema = z.object({
  id: z.string().regex(SERVER_ID),
  name: z.string().trim().min(1).max(40),
  edition: z.literal('java').default('java'),
  loader: LoaderSchema,
  mcVersion: z.string().min(1),
  /** Konkreter Build (z. B. Paper-Build), falls vorhanden. */
  build: z.string().optional(),
  port: z.number().int().min(1024).max(65535),
  ramMb: z.number().int().min(512).max(131072),
  jvmPreset: JvmPresetSchema.default('aikar'),
  javaMajor: z.number().int().min(8).max(99),
  launch: LaunchSchema.default({ type: 'jar', jar: 'server.jar' }),
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
