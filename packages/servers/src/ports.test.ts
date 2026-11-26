import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { findFreePort, isPortFree } from './ports'

describe('ports', () => {
  it('erkennt belegte Ports', async () => {
    const s = createServer()
    await new Promise<void>((r) => s.listen(0, '0.0.0.0', r))
    const port = (s.address() as { port: number }).port
    expect(await isPortFree(port)).toBe(false)
    s.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(await isPortFree(port)).toBe(true)
  })
  it('überspringt bekannte und belegte Ports', async () => {
    const p = await findFreePort(25565, new Set([25565, 25566]), async (x) => x !== 25567)
    expect(p).toBe(25568)
  })
})
