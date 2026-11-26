import archiver from 'archiver'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ServerFiles } from './files'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'trm-files-'))
  mkdirSync(join(root, 'config'))
  mkdirSync(join(root, '.trm'))
  writeFileSync(join(root, 'server.properties'), 'motd=Hi\n')
  writeFileSync(join(root, 'config', 'a.toml'), 'a=1')
  writeFileSync(join(root, 'server.jar'), 'jar')
  return { root, f: new ServerFiles(root) }
}

describe('ServerFiles', () => {
  it('listet Ordner zuerst und versteckt interne Daten', () => {
    const { f } = setup()
    expect(f.list('').map((e) => e.name)).toEqual(['config', 'server.jar', 'server.properties'])
  })
  it('liest und schreibt Textdateien atomar', () => {
    const { f, root } = setup()
    expect(f.read('server.properties').content).toBe('motd=Hi\n')
    f.write('config/new/b.yml', 'x: 1')
    expect(readFileSync(join(root, 'config/new/b.yml'), 'utf8')).toBe('x: 1')
  })
  it('lehnt Binärdateien und große Dateien ab', () => {
    const { f, root } = setup()
    writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 0, 2]))
    expect(() => f.read('bin.dat')).toThrow(/Binär/)
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(3 * 1024 * 1024))
    expect(() => f.read('big.txt')).toThrow(/zu groß/)
  })
  it('blockiert Ausbruch, absolute Pfade und geschützte Bereiche', () => {
    const { f } = setup()
    for (const bad of ['../x', '../../etc/passwd', 'a/../../b', 'C:/Windows', '.trm/mods.json']) expect(() => f.read(bad), bad).toThrow()
    expect(() => f.write('../evil.txt', 'x')).toThrow()
    expect(() => f.delete('')).toThrow(/nicht gelöscht/)
    expect(() => f.delete('server.jar')).toThrow(/nicht gelöscht/)
    expect(() => f.rename('server.jar', 'x.jar')).toThrow()
  })
  it('benennt um, löscht und legt Ordner an', () => {
    const { f, root } = setup()
    f.mkdir('plugins/data')
    f.rename('config/a.toml', 'config/b.toml')
    expect(existsSync(join(root, 'config/b.toml'))).toBe(true)
    expect(() => f.rename('config/b.toml', 'server.properties')).toThrow(/existiert/)
    f.delete('config')
    expect(existsSync(join(root, 'config'))).toBe(false)
  })
  it('entpackt ZIPs in einen Ordner und lehnt Zip-Slip ab', async () => {
    const { f, root } = setup()
    const make = (name: string, entry: string) => new Promise<void>((resolve) => {
      const out = createWriteStream(join(root, name))
      out.on('close', () => resolve())
      const a = archiver('zip')
      a.pipe(out)
      a.append('hi', { name: entry })
      void a.finalize()
    })
    await make('pack.zip', 'inner/readme.txt')
    await f.unzip('pack.zip')
    expect(readFileSync(join(root, 'pack/inner/readme.txt'), 'utf8')).toBe('hi')
    await expect(f.unzip('pack.zip')).rejects.toThrow(/existiert/)
    await expect(f.unzip('server.properties')).rejects.toThrow(/ZIP/)
  })
  it('lädt Dateien hoch und überschreibt nichts', () => {
    const { f, root } = setup()
    const src = join(mkdtempSync(join(tmpdir(), 'trm-src-')), 'icon.png')
    writeFileSync(src, 'png')
    expect(f.upload('', [src])).toBe(1)
    expect(readFileSync(join(root, 'icon.png'), 'utf8')).toBe('png')
    expect(() => f.upload('', [src])).toThrow(/existiert/)
  })
})
