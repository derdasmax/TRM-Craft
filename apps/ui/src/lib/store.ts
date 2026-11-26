import { create } from 'zustand'
import { defaultSettings, mergeSettings, type AppInfo, type DeepPartial, type Settings } from '@trm/core'
import { invoke, onEvent } from './bridge'

interface State {
  ready: boolean
  settings: Settings
  info: AppInfo | null
  page: 'dashboard' | 'settings'
  setPage: (p: State['page']) => void
  update: (patch: DeepPartial<Settings>) => Promise<void>
  init: () => Promise<void>
}

export const useStore = create<State>((set) => ({
  ready: false,
  settings: defaultSettings,
  info: null,
  page: 'dashboard',
  setPage: (page) => set({ page }),
  update: async (patch) => {
    // optimistisch, dann mit Antwort des Main-Prozesses abgleichen
    set((s) => ({ settings: mergeSettings(s.settings, patch) }))
    const next = await invoke('settings.update', patch)
    set({ settings: next })
  },
  init: async () => {
    const [settings, info] = await Promise.all([invoke('settings.get'), invoke('app.info')])
    set({ settings, info, ready: true })
    onEvent('settings.changed', (s) => set({ settings: s }))
  },
}))
