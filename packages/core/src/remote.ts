import type { Role } from './commands'
import type { TunnelState } from './net'

export type RemoteTunnelPhase = 'none' | 'ready' | 'stopped' | 'downloading' | 'starting' | 'connected' | 'error'

export interface RemoteTunnelInfo {
  /** `none`: noch nicht eingerichtet. */
  phase: RemoteTunnelPhase
  host?: string
  serviceInstalled: boolean
  /** Die API ist über die öffentliche Adresse erreichbar (geprüft). */
  reachable?: boolean
  lines: TunnelState['lines']
  error?: string
}

export interface RemoteStatus {
  enabled: boolean
  /** Der lokale API-Server lauscht. */
  listening: boolean
  mode: 'tunnel' | 'direct'
  port: number
  /** Adresse, unter der die Webseite die App erreicht (Tunnel-Host oder eigene Domain). */
  publicUrl?: string
  tunnel: RemoteTunnelInfo
  devices: number
  /** Gerade verbundene Browser-Sitzungen (WebSocket oder aktive Tokens). */
  sessions: { id: string; user: string; role: Role; device: string; since: number }[]
  /** Offener Kopplungscode (Weg A). */
  pairing?: { code: string; expiresAt: number }
  lastError?: string
}

export interface DeviceInfo {
  id: string
  name: string
  role: Role
  canUpload: boolean
  createdAt: number
  lastSeen?: number
  /** Anzahl aktiver Sitzungen dieses Geräts. */
  sessions: number
}

export type UploadStatus = 'receiving' | 'done' | 'failed' | 'undone'

export interface UploadRecord {
  id: string
  time: number
  uploader: string
  serverId: string
  serverName: string
  fileName: string
  kind: string
  size: number
  status: UploadStatus
  warnings: string[]
  error?: string
  /** Fortschritt in Bytes, solange der Upload läuft. */
  received?: number
  undoable: boolean
}
