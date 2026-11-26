import { useStore } from './store'

/** Führt eine Aktion aus und zeigt Fehler als Hinweis an, statt sie zu verschlucken. */
export async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    // Electron hängt "Error invoking remote method ..." an
    const msg = raw.replace(/^Error invoking remote method '[^']+': (Error: |TypeError: )?/, '')
    useStore.getState().notify(/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg) ? 'Keine Verbindung zum Dienst. Prüfe deine Internetverbindung.' : msg)
    return undefined
  }
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${s % 60} s` : `${s} s`
}
