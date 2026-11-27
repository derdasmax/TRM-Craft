import type { DeepPartial, Settings } from './settings'
import type { UpdaterState } from './updater'
import type { DeviceInfo, RemoteStatus, UploadRecord } from './remote'
import type { CloudflareStatus, DomainConfig, FirewallStatus, JoinInfo, NetInfo, ReachResult, TunnelState, UpnpStatus } from './net'
import type { BackupInfo, FileContent, FileEntry, PlayerAction, PlayerEntry, ScheduleTask, StatsSample, WorldInfo } from './ops'
import type { InstalledMod, ModInstallResult, ModpackInstallArgs, ModSearchArgs, ModSearchResult, ModSource, ModUpdate } from './mods'
import type { ImportServerInput, SoftwareStatus, CreateServerInput, LogEvent, ProgressEvent, ServerRecord, ServerView, SystemMemory, SystemUsage, Loader, VersionInfo } from './servers'

/**
 * Einheitliche Command-API. UI (IPC) und später die Webseite (WebSocket)
 * rufen exakt dieselben Commands auf.
 */
export type Role = 'owner' | 'admin' | 'moderator' | 'viewer'

export interface AppInfo {
  name: string
  version: string
  platform: string
  dataDir: string
  isPackaged: boolean
}

export interface CommandMap {
  'app.info': { args: void; result: AppInfo }
  'settings.get': { args: void; result: Settings }
  'settings.update': { args: DeepPartial<Settings>; result: Settings }
  'window.minimize': { args: void; result: void }
  'window.toggleMaximize': { args: void; result: boolean }
  'window.close': { args: void; result: void }
  'window.isMaximized': { args: void; result: boolean }
  'shell.openExternal': { args: string; result: void }
  'updater.getState': { args: void; result: UpdaterState }
  'updater.check': { args: void; result: void }
  'updater.download': { args: void; result: void }
  'updater.installNow': { args: void; result: void }
  'updater.skipCountdown': { args: void; result: void }
  'system.memory': { args: void; result: SystemMemory }
  'versions.list': { args: Loader; result: VersionInfo[] }
  'servers.list': { args: void; result: ServerView[] }
  'servers.create': { args: { token: string; input: CreateServerInput }; result: ServerRecord }
  'servers.update': { args: { id: string; patch: Partial<Pick<ServerRecord, 'name' | 'ramMb' | 'jvmPreset' | 'autoRestart' | 'autostart' | 'port' | 'backup' | 'notify' | 'limits'>> }; result: ServerRecord }
  'servers.start': { args: string; result: void }
  'servers.stop': { args: string; result: void }
  'servers.restart': { args: string; result: void }
  'servers.kill': { args: string; result: void }
  'servers.delete': { args: string; result: void }
  'servers.command': { args: { id: string; command: string }; result: void }
  'servers.logs': { args: string; result: string[] }
  'servers.properties.get': { args: string; result: Record<string, string> }
  'servers.properties.set': { args: { id: string; values: Record<string, string> }; result: void }
  'mods.search': { args: ModSearchArgs; result: ModSearchResult }
  'mods.installed': { args: string; result: InstalledMod[] }
  'mods.install': { args: { id: string; source: ModSource; projectId: string }; result: ModInstallResult }
  'mods.addFiles': { args: { id: string; paths: string[]; force?: boolean }; result: ModInstallResult }
  'mods.toggle': { args: { id: string; file: string; enabled: boolean }; result: void }
  'mods.remove': { args: { id: string; file: string }; result: void }
  'mods.checkUpdates': { args: string; result: ModUpdate[] }
  'mods.update': { args: { id: string; file: string }; result: void }
  'modpacks.install': { args: ModpackInstallArgs; result: { record: ServerRecord; warnings: string[] } }
  'servers.softwareStatus': { args: string; result: SoftwareStatus }
  'servers.updateSoftware': { args: string; result: void }
  'servers.clone': { args: { id: string; name: string }; result: ServerRecord }
  'servers.import': { args: ImportServerInput; result: ServerRecord }
  'servers.setIcon': { args: { id: string; png: string }; result: void }
  'servers.getIcon': { args: string; result: string | null }
  'players.list': { args: string; result: PlayerEntry[] }
  'players.action': { args: { id: string; action: PlayerAction; name: string; arg?: string }; result: void }
  'files.list': { args: { id: string; path: string }; result: FileEntry[] }
  'files.read': { args: { id: string; path: string }; result: FileContent }
  'files.write': { args: { id: string; path: string; content: string }; result: void }
  'files.mkdir': { args: { id: string; path: string }; result: void }
  'files.delete': { args: { id: string; path: string }; result: void }
  'files.rename': { args: { id: string; from: string; to: string }; result: void }
  'files.unzip': { args: { id: string; path: string }; result: void }
  'files.upload': { args: { id: string; dir: string; paths: string[] }; result: number }
  'worlds.list': { args: string; result: WorldInfo[] }
  'worlds.setActive': { args: { id: string; name: string }; result: void }
  'worlds.export': { args: { id: string; name: string; dest: string }; result: void }
  'worlds.import': { args: { id: string; zipPath: string }; result: string }
  'worlds.reset': { args: { id: string; name: string }; result: void }
  'backups.list': { args: string; result: BackupInfo[] }
  'backups.create': { args: { id: string; label?: string }; result: BackupInfo }
  'backups.restore': { args: { id: string; file: string }; result: void }
  'backups.delete': { args: { id: string; file: string }; result: void }
  'schedules.list': { args: void; result: ScheduleTask[] }
  'schedules.save': { args: ScheduleTask; result: ScheduleTask }
  'schedules.delete': { args: string; result: void }
  'stats.history': { args: string; result: StatsSample[] }
  'spark.profiler': { args: { id: string; action: 'start' | 'stop' }; result: void }
  'notify.discordTest': { args: string; result: void }
  'dialog.open': { args: { filters?: { name: string; extensions: string[] }[] }; result: string | null }
  'dialog.save': { args: { defaultName: string }; result: string | null }
  'dialog.folder': { args: void; result: string | null }
  'net.info': { args: void; result: NetInfo }
  'net.join': { args: string; result: JoinInfo }
  'net.reach': { args: string; result: ReachResult[] }
  'net.upnp.status': { args: void; result: UpnpStatus }
  'net.upnp.open': { args: string; result: void }
  'net.upnp.close': { args: string; result: void }
  'net.firewall.status': { args: string; result: FirewallStatus }
  'net.firewall.add': { args: string; result: void }
  'net.firewall.remove': { args: string; result: void }
  'net.cf.verify': { args: void; result: CloudflareStatus }
  'net.domain.get': { args: string; result: DomainConfig | null }
  'net.domain.set': { args: { id: string; domain: string; sub: string; srv: boolean }; result: DomainConfig }
  'net.domain.remove': { args: string; result: void }
  'net.ddns.run': { args: void; result: void }
  'net.tunnel.state': { args: void; result: TunnelState }
  'net.tunnel.start': { args: void; result: void }
  'net.tunnel.stop': { args: void; result: void }
  'remote.status': { args: void; result: RemoteStatus }
  'remote.pairStart': { args: { upload: boolean }; result: RemoteStatus }
  'remote.pairCancel': { args: void; result: void }
  'remote.claim': { args: { siteUrl: string; code: string; upload: boolean }; result: void }
  'remote.devices': { args: void; result: DeviceInfo[] }
  'remote.revoke': { args: string; result: void }
  'remote.tunnel.setup': { args: { domain: string; sub: string }; result: RemoteStatus }
  'remote.tunnel.start': { args: void; result: void }
  'remote.tunnel.stop': { args: void; result: void }
  'remote.tunnel.service': { args: { install: boolean }; result: void }
  'remote.tunnel.remove': { args: void; result: void }
  'remote.uploads': { args: void; result: UploadRecord[] }
  'remote.undo': { args: string; result: void }
  'secrets.set': { args: { name: SecretName; value: string }; result: void }
  'secrets.has': { args: SecretName; result: boolean }
  'secrets.delete': { args: SecretName; result: void }
}

/** Namen der Geheimnisse, die verschlüsselt im Windows-Credential-Schutz (DPAPI) liegen. */
export type SecretName = 'curseforge' | 'cloudflare' | `discord:${string}`

/** Das Geräte-Token der Webseite wird nie über die UI gesetzt oder gelesen. */
export type InternalSecret = 'remote'

export type CommandName = keyof CommandMap
export type CommandArgs<K extends CommandName> = CommandMap[K]['args']
export type CommandResult<K extends CommandName> = CommandMap[K]['result']

/** Mindestrolle pro Command (für die Remote-API). Lokale UI ist immer Owner. */
export const commandRoles: Record<CommandName, Role> = {
  'app.info': 'viewer',
  'settings.get': 'viewer',
  'settings.update': 'admin',
  'window.minimize': 'owner',
  'window.toggleMaximize': 'owner',
  'window.close': 'owner',
  'window.isMaximized': 'owner',
  'shell.openExternal': 'owner',
  'updater.getState': 'viewer',
  'updater.check': 'admin',
  'updater.download': 'admin',
  'updater.installNow': 'owner',
  'updater.skipCountdown': 'owner',
  'system.memory': 'viewer',
  'versions.list': 'viewer',
  'servers.list': 'viewer',
  'servers.create': 'admin',
  'servers.update': 'admin',
  'servers.start': 'moderator',
  'servers.stop': 'moderator',
  'servers.restart': 'moderator',
  'servers.kill': 'admin',
  'servers.delete': 'owner',
  'servers.command': 'moderator',
  'servers.logs': 'viewer',
  'servers.properties.get': 'admin',
  'servers.properties.set': 'admin',
  'mods.search': 'viewer',
  'mods.installed': 'viewer',
  'mods.install': 'admin',
  'mods.addFiles': 'admin',
  'mods.toggle': 'admin',
  'mods.remove': 'admin',
  'mods.checkUpdates': 'viewer',
  'mods.update': 'admin',
  'modpacks.install': 'admin',
  'servers.softwareStatus': 'viewer',
  'servers.updateSoftware': 'admin',
  'servers.clone': 'admin',
  'servers.import': 'admin',
  'servers.setIcon': 'admin',
  'servers.getIcon': 'viewer',
  'players.list': 'viewer',
  'players.action': 'moderator',
  'files.list': 'admin',
  'files.read': 'admin',
  'files.write': 'admin',
  'files.mkdir': 'admin',
  'files.delete': 'admin',
  'files.rename': 'admin',
  'files.unzip': 'admin',
  'files.upload': 'admin',
  'worlds.list': 'viewer',
  'worlds.setActive': 'admin',
  'worlds.export': 'admin',
  'worlds.import': 'admin',
  'worlds.reset': 'owner',
  'backups.list': 'viewer',
  'backups.create': 'moderator',
  'backups.restore': 'admin',
  'backups.delete': 'admin',
  'schedules.list': 'viewer',
  'schedules.save': 'admin',
  'schedules.delete': 'admin',
  'stats.history': 'viewer',
  'spark.profiler': 'admin',
  'notify.discordTest': 'admin',
  'dialog.open': 'owner',
  'dialog.save': 'owner',
  'dialog.folder': 'owner',
  'net.info': 'viewer',
  'net.join': 'viewer',
  'net.reach': 'admin',
  'net.upnp.status': 'admin',
  'net.upnp.open': 'admin',
  'net.upnp.close': 'admin',
  'net.firewall.status': 'admin',
  'net.firewall.add': 'owner',
  'net.firewall.remove': 'owner',
  'net.cf.verify': 'owner',
  'net.domain.get': 'admin',
  'net.domain.set': 'owner',
  'net.domain.remove': 'owner',
  'net.ddns.run': 'admin',
  'net.tunnel.state': 'admin',
  'net.tunnel.start': 'owner',
  'net.tunnel.stop': 'owner',
  'remote.status': 'owner',
  'remote.pairStart': 'owner',
  'remote.pairCancel': 'owner',
  'remote.claim': 'owner',
  'remote.devices': 'owner',
  'remote.revoke': 'owner',
  'remote.tunnel.setup': 'owner',
  'remote.tunnel.start': 'owner',
  'remote.tunnel.stop': 'owner',
  'remote.tunnel.service': 'owner',
  'remote.tunnel.remove': 'owner',
  'remote.uploads': 'owner',
  'remote.undo': 'owner',
  'secrets.set': 'owner',
  'secrets.has': 'owner',
  'secrets.delete': 'owner',
}

const roleRank: Record<Role, number> = { viewer: 0, moderator: 1, admin: 2, owner: 3 }

export function roleAllows(role: Role, command: CommandName): boolean {
  return roleRank[role] >= roleRank[commandRoles[command]]
}

export const IPC_CHANNEL = 'trm:invoke'
export const IPC_EVENT_CHANNEL = 'trm:event'

export interface AppEvents {
  'window.maximized': boolean
  'settings.changed': Settings
  'updater.state': UpdaterState
  'servers.status': ServerView
  'servers.removed': string
  'servers.log': LogEvent
  'servers.progress': ProgressEvent
  'servers.stats': { id: string; sample: StatsSample }
  'net.tunnel': TunnelState
  'remote.status': RemoteStatus
  'remote.upload': UploadRecord
  'system.usage': SystemUsage
}
export type EventName = keyof AppEvents
