export interface NetInfo {
  publicIp: string | null
  localIps: string[]
}

export interface ReachResult {
  /** Server läuft und ist von außen erreichbar. */
  online: boolean
  /** Geprüfte Adresse (IP:Port). */
  address: string
  /** Kurze Erklärung, falls nicht erreichbar. */
  hint?: string
}

export interface UpnpStatus {
  available: boolean
  externalIp?: string
  /** Von TRM-Craft angelegte Weiterleitungen (Port/Protokoll). */
  mapped: { port: number; protocol: 'TCP' | 'UDP' }[]
}

export interface FirewallStatus {
  supported: boolean
  rules: { port: number; protocol: 'TCP' | 'UDP'; present: boolean }[]
}

export interface CloudflareStatus {
  ok: boolean
  message?: string
}

export interface DomainConfig {
  serverId: string
  /** Vollständiger Hostname, z. B. play.meinname.net */
  host: string
  zoneName: string
  /** Java-SRV-Eintrag angelegt, damit Spieler ohne Port joinen können. */
  srv: boolean
  lastIp?: string
  lastUpdated?: number
}

export interface TunnelState {
  status: 'stopped' | 'downloading' | 'starting' | 'running' | 'error'
  /** Link, über den der Agent mit dem playit.gg-Konto verbunden wird. */
  claimUrl?: string
  /** Letzte Ausgabezeilen des Agenten. */
  lines: string[]
  error?: string
}

export interface JoinInfo {
  java?: { address: string; note?: string }
  bedrock?: { address: string; port: number }
}
