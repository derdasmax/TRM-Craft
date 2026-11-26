// Typen für Spieler, Dateien, Welten, Backups, Zeitpläne und Leistung.

export interface PlayerEntry {
  name: string
  online: boolean
  firstSeen: number
  lastSeen: number
  sessions: number
  /** Gesamte Spielzeit in Millisekunden (laufende Sitzung eingeschlossen). */
  playMs: number
}

export type PlayerAction = 'kick' | 'ban' | 'pardon' | 'op' | 'deop' | 'whitelistAdd' | 'whitelistRemove' | 'gamemode' | 'tp' | 'say'

export interface FileEntry {
  name: string
  dir: boolean
  size: number
  modified: number
}

export interface FileContent {
  content: string
  size: number
}

export interface WorldInfo {
  name: string
  active: boolean
  sizeBytes: number
  seed?: string
}

export interface BackupInfo {
  file: string
  size: number
  created: number
  label?: string
}

export interface BackupSettings {
  /** Zielordner, z. B. auf einem anderen Laufwerk. Leer = Standardordner in den App-Daten. */
  dir?: string
  /** So viele Backups werden behalten, ältere werden gelöscht. */
  keep: number
}

export interface NotifySettings {
  desktop: boolean
  discord: boolean
  joins: boolean
}

export type ScheduleSpec =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }

export type ScheduleAction =
  | { type: 'restart'; warnSeconds: number }
  | { type: 'backup' }
  | { type: 'command'; command: string }
  | { type: 'announce'; message: string }

export interface ScheduleTask {
  id: string
  serverId: string
  name: string
  enabled: boolean
  spec: ScheduleSpec
  action: ScheduleAction
  lastRun?: number
}

export interface StatsSample {
  t: number
  /** Prozessorauslastung des Servers in Prozent (100 = ein voller Kern). */
  cpu: number
  ramMb: number
  players: number
  /** Ticks pro Sekunde, nur wenn der Server `tps` kennt (Paper, Purpur, Folia). */
  tps?: number
}
