import type { DeepPartial, Settings } from './settings'
import type { UpdaterState } from './updater'

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
}

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
}
export type EventName = keyof AppEvents
