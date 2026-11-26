import archiver from 'archiver'
import { createWriteStream, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectJar, isCompatible } from './jarinfo'

async function jar(files: string[]): Promise<string> {
  const p = join(mkdtempSync(join(tmpdir(), 'trm-jar-')), 'x.jar')
  await new Promise<void>((resolve) => {
    const out = createWriteStream(p)
    out.on('close', () => resolve())
    const a = archiver('zip')
    a.pipe(out)
    for (const f of files) a.append('x', { name: f })
    void a.finalize()
  })
  return p
}

describe('inspectJar', () => {
  it('erkennt Fabric, Forge, NeoForge und Bukkit', async () => {
    expect((await inspectJar(await jar(['fabric.mod.json']))).kinds).toEqual(['fabric'])
    expect((await inspectJar(await jar(['META-INF/mods.toml']))).kinds).toEqual(['forge'])
    expect((await inspectJar(await jar(['META-INF/neoforge.mods.toml']))).kinds).toEqual(['neoforge'])
    expect((await inspectJar(await jar(['plugin.yml']))).kinds).toEqual(['bukkit'])
    expect((await inspectJar(await jar(['foo.class']))).kinds).toEqual(['unknown'])
  })
  it('wirft bei defekten Dateien', async () => {
    await expect(inspectJar('/etc/hostname')).rejects.toThrow()
  })
})

describe('isCompatible', () => {
  it('prüft Loader gegen Dateiart', async () => {
    const fabric = await inspectJar(await jar(['fabric.mod.json']))
    const bukkit = await inspectJar(await jar(['plugin.yml']))
    const unknown = await inspectJar(await jar(['a.class']))
    expect(isCompatible('fabric', fabric)).toBe(true)
    expect(isCompatible('quilt', fabric)).toBe(true)
    expect(isCompatible('forge', fabric)).toBe(false)
    expect(isCompatible('paper', bukkit)).toBe(true)
    expect(isCompatible('velocity', bukkit)).toBe(false)
    expect(isCompatible('forge', unknown)).toBe(true)
  })
})
