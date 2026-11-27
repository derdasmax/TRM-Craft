import { create } from 'zustand'
import { defaultSettings, mergeSettings, type AppInfo, type DeepPartial, type ProgressEvent, type ServerView, type Settings, type StatsSample, type TunnelState, type RemoteStatus, type DeviceInfo, type SystemUsage, type UploadRecord, type UpdaterState } from '@trm/core'
import { invoke, onEvent } from './bridge'

const LOG_CAP = 1500

export type Page = 'dashboard' | 'settings' | 'server'
export type ServerTab = 'console' | 'players' | 'files' | 'worlds' | 'backups' | 'schedules' | 'perf' | 'network' | 'mods' | 'settings'

interface State {
  ready: boolean
  settings: Settings
  info: AppInfo | null
  updater: UpdaterState | null
  dismissedVersion: string | null
  servers: Record<string, ServerView>
  logs: Record<string, string[]>
  progress: Record<string, ProgressEvent>
  stats: Record<string, StatsSample[]>
  tunnel: TunnelState
  remote: RemoteStatus | null
  devices: DeviceInfo[]
  usage: SystemUsage | null
  uploads: UploadRecord[]
  page: Page
  selected: string | null
  wizardOpen: boolean
  packOpen: boolean
  paletteOpen: boolean
  serverTab: ServerTab
  toast: string | null
  dismiss: (v: string) => void
  setPage: (p: Page) => void
  openServer: (id: string) => void
  setWizard: (open: boolean) => void
  setPack: (open: boolean) => void
  setPalette: (open: boolean) => void
  setServerTab: (t: ServerTab) => void
  notify: (msg: string) => void
  update: (patch: DeepPartial<Settings>) => Promise<void>
  init: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: defaultSettings,
  info: null,
  updater: null,
  dismissedVersion: null,
  servers: {},
  logs: {},
  progress: {},
  stats: {},
  tunnel: { status: 'stopped', lines: [] },
  remote: null,
  devices: [],
  usage: null,
  uploads: [],
  page: 'dashboard',
  selected: null,
  wizardOpen: false,
  packOpen: false,
  paletteOpen: false,
  serverTab: 'console',
  toast: null,
  dismiss: (v) => set({ dismissedVersion: v }),
  setPage: (page) => set({ page }),
  openServer: (id) => set({ page: 'server', selected: id, serverTab: 'console' }),
  setWizard: (wizardOpen) => set({ wizardOpen }),
  setPack: (packOpen) => set({ packOpen }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setServerTab: (serverTab) => set({ serverTab }),
  notify: (toast) => {
    set({ toast })
    setTimeout(() => get().toast === toast && set({ toast: null }), 5000)
  },
  update: async (patch) => {
    set((s) => ({ settings: mergeSettings(s.settings, patch) }))
    set({ settings: await invoke('settings.update', patch) })
  },
  init: async () => {
    const [settings, info, updater, list] = await Promise.all([invoke('settings.get'), invoke('app.info'), invoke('updater.getState'), invoke('servers.list')])
    set({ settings, info, updater, servers: Object.fromEntries(list.map((s) => [s.id, s])), ready: true })
    onEvent('settings.changed', (s) => set({ settings: s }))
    onEvent('updater.state', (u) => set({ updater: u }))
    onEvent('servers.status', (v) => set((s) => ({ servers: { ...s.servers, [v.id]: v } })))
    onEvent('servers.removed', (id) =>
      set((s) => {
        const { [id]: _, ...rest } = s.servers
        return { servers: rest, page: s.selected === id ? 'dashboard' : s.page, selected: s.selected === id ? null : s.selected }
      }),
    )
    // Konsolenzeilen werden gesammelt und alle 100 ms in einem Schritt eingefügt. Das spart bei vielen Zeilen (Serverstart) Rechenzeit.
    const pending = new Map<string, string[]>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      const batch = [...pending]
      pending.clear()
      set((s) => {
        const logs = { ...s.logs }
        for (const [id, add] of batch) {
          const cur = logs[id] ?? []
          const all = cur.length + add.length > LOG_CAP ? [...cur, ...add].slice(-LOG_CAP) : [...cur, ...add]
          logs[id] = all
        }
        return { logs }
      })
    }
    onEvent('servers.log', ({ id, line }) => {
      const list = pending.get(id) ?? []
      list.push(line)
      pending.set(id, list)
      if (!timer) timer = setTimeout(flush, 100)
    })
    onEvent('servers.stats', ({ id, sample }) => set((s) => ({ stats: { ...s.stats, [id]: [...(s.stats[id] ?? []).slice(-359), sample] } })))
    onEvent('net.tunnel', (tunnel) => set({ tunnel }))
    invoke('net.tunnel.state').then((tunnel) => set({ tunnel })).catch(() => {})
    const loadDevices = () => invoke('remote.devices').then((devices) => set({ devices })).catch(() => {})
    onEvent('system.usage', (usage) => set({ usage }))
    onEvent('remote.status', (remote) => { set({ remote }); void loadDevices() })
    void loadDevices()
    onEvent('remote.upload', (u) => set((s) => ({ uploads: [u, ...s.uploads.filter((x) => x.id !== u.id)].slice(0, 200) })))
    invoke('remote.status').then((remote) => set({ remote })).catch(() => {})
    invoke('remote.uploads').then((uploads) => set({ uploads })).catch(() => {})
    onEvent('servers.progress', (p) => set((s) => ({ progress: { ...s.progress, [p.token]: p } })))
  },
}))

/** Lädt den Log-Puffer eines Servers (beim Öffnen der Konsole). */
export async function loadLogs(id: string) {
  const lines = await invoke('servers.logs', id)
  useStore.setState((s) => ({ logs: { ...s.logs, [id]: lines } }))
}

export async function loadStats(id: string) {
  const h = await invoke('stats.history', id)
  useStore.setState((s) => ({ stats: { ...s.stats, [id]: h } }))
}
