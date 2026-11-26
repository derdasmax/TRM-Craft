import { contextBridge, ipcRenderer } from 'electron'

const INVOKE = 'trm:invoke'
const EVENT = 'trm:event'

// Bewusst keine Typen-Importe zur Laufzeit: Preload bleibt minimal und sandbox-tauglich.
contextBridge.exposeInMainWorld('trm', {
  invoke: (command: string, args?: unknown) => ipcRenderer.invoke(INVOKE, command, args),
  on: (event: string, cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, name: string, payload: unknown) => {
      if (name === event) cb(payload)
    }
    ipcRenderer.on(EVENT, handler)
    return () => ipcRenderer.removeListener(EVENT, handler)
  },
})
