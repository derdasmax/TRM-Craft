import type { Role } from './commands'

export interface RemoteStatus {
  enabled: boolean
  paired: boolean
  connected: boolean
  url: string
  siteName?: string
  lastError?: string
  /** Weitere Geräte bzw. Sitzungen, die gerade über die Webseite verbunden sind. */
  sessions: { id: string; name: string; role: Role; since: number }[]
  canUpload: boolean
  /** Aktueller Übertragungsweg: WebSocket oder HTTPS-Long-Polling (Fallback). */
  transport?: 'websocket' | 'polling'
  /** Läuft gerade eine Kopplung "von der App aus": Code, der auf der Webseite einzugeben ist. */
  pairing?: { code: string; expiresAt: number }
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
