import { createSocket } from 'node:dgram'
import { createServer } from 'node:net'

export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => s.close(() => resolve(true)))
    s.listen(port, host)
  })
}

/** Nächster freier Port ab `start`, der weder von bekannten Servern noch vom System belegt ist. */
export async function findFreePort(start: number, taken: Set<number>, check = isPortFree): Promise<number> {
  for (let p = start; p < 65535; p++) if (!taken.has(p) && (await check(p))) return p
  throw new Error('Kein freier Port gefunden.')
}

export function isUdpPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createSocket('udp4')
    s.once('error', () => resolve(false))
    s.once('listening', () => s.close(() => resolve(true)))
    s.bind(port, host)
  })
}
