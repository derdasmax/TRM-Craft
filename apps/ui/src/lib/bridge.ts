import type { AppEvents, CommandArgs, CommandName, CommandResult, EventName, Settings } from '@trm/core'
import { defaultSettings, mergeSettings } from '@trm/core'

interface TrmBridge {
  invoke(command: string, args?: unknown): Promise<unknown>
  on(event: string, cb: (payload: unknown) => void): () => void
  pathForFile?(file: File): string
}
declare global {
  interface Window { trm?: TrmBridge }
}

/** Browser-Fallback für `pnpm dev` ohne Electron (Einstellungen in localStorage). */
function browserBridge(): TrmBridge {
  const KEY = 'trm-settings'
  let settings: Settings = defaultSettings
  try { settings = mergeSettings(defaultSettings, JSON.parse(localStorage.getItem(KEY) ?? '{}')) } catch { /* ignore */ }
  const listeners = new Set<(e: string, p: unknown) => void>()
  return {
    async invoke(command, args) {
      switch (command) {
        case 'app.info': return { name: 'TRM-Craft', version: '0.0.0-dev', platform: 'web', dataDir: '(Browser)', isPackaged: false }
        case 'settings.get': return settings
        case 'settings.update':
          settings = mergeSettings(settings, args as never)
          try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* ignore */ }
          listeners.forEach((l) => l('settings.changed', settings))
          return settings
        case 'system.memory': return { totalMb: 16384, freeMb: 8000 }
        case 'servers.list': return []
        case 'versions.list': return [{ id: '1.21.4', type: 'release' }, { id: '1.21.3', type: 'release' }, { id: '1.20.6', type: 'release' }]
        case 'updater.getState': return { phase: 'uptodate', currentVersion: '0.0.0-dev' }
        case 'window.toggleMaximize': case 'window.isMaximized': return false
        default: return undefined
      }
    },
    on(event, cb) {
      const l = (e: string, p: unknown) => e === event && cb(p)
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

const bridge: TrmBridge = window.trm ?? browserBridge()
export const isElectron = !!window.trm
export const pathForFile = (f: File): string | null => bridge.pathForFile?.(f) || null

export function invoke<K extends CommandName>(command: K, ...args: CommandArgs<K> extends void ? [] : [CommandArgs<K>]): Promise<CommandResult<K>> {
  return bridge.invoke(command, args[0]) as Promise<CommandResult<K>>
}
export function onEvent<K extends EventName>(event: K, cb: (payload: AppEvents[K]) => void): () => void {
  return bridge.on(event, cb as (p: unknown) => void)
}
