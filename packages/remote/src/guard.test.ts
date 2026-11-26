import { describe, expect, it } from 'vitest'
import { commandRoles, type CommandName } from '@trm/core'
import { authorizeRemote, isRemoteAllowed, type GuardConfig } from './guard'

const known = (c: string): c is CommandName => c in commandRoles
const cfg: GuardConfig = { enabled: true, maxRole: 'admin' }
const ok = (c: string, a: unknown, role: Parameters<typeof authorizeRemote>[2], conf = cfg) => () => authorizeRemote(c, a, role, conf, known)

describe('Remote-Schutz', () => {
  it('sperrt lokale Befehle komplett', () => {
    for (const c of ['window.close', 'shell.openExternal', 'dialog.open', 'secrets.set', 'secrets.has', 'remote.pair', 'updater.installNow', 'mods.addFiles', 'files.upload', 'worlds.import', 'worlds.export', 'net.firewall.add', 'servers.import']) {
      expect(isRemoteAllowed(c), c).toBe(false)
      expect(ok(c, {}, 'owner'), c).toThrow(/nicht erlaubt/)
    }
  })
  it('lässt erlaubte Befehle je nach Rolle zu', () => {
    expect(ok('servers.list', undefined, 'viewer')).not.toThrow()
    expect(ok('servers.start', 's', 'moderator')).not.toThrow()
    expect(ok('servers.start', 's', 'viewer')).toThrow(/Berechtigung/)
    expect(ok('files.write', { id: 's', path: 'a', content: 'x' }, 'moderator')).toThrow(/Berechtigung/)
    expect(ok('files.write', { id: 's', path: 'a', content: 'x' }, 'admin')).not.toThrow()
  })
  it('kappt die Rolle an der lokalen Obergrenze', () => {
    expect(ok('servers.delete', 's', 'owner')).toThrow(/Berechtigung/) // Owner-Befehl, Obergrenze admin
    expect(ok('servers.kill', 's', 'owner', { enabled: true, maxRole: 'moderator' })).toThrow(/Berechtigung/)
  })
  it('lehnt unbekannte Befehle und ausgeschalteten Fernzugriff ab', () => {
    expect(ok('nope.nope', {}, 'owner')).toThrow(/Unbekannt/)
    expect(ok('servers.list', undefined, 'owner', { enabled: false, maxRole: 'admin' })).toThrow(/ausgeschaltet/)
  })
  it('verbietet lokale Pfade in Argumenten', () => {
    expect(ok('servers.create', { token: 't', input: { worldZip: 'C:/x.zip' } }, 'admin')).toThrow(/Upload/)
    expect(ok('modpacks.install', { source: { type: 'file', path: 'C:/x' } }, 'admin')).toThrow(/Upload/)
    expect(ok('servers.update', { id: 's', patch: { backup: { dir: 'C:/Windows', keep: 3 } } }, 'admin')).toThrow(/lokal/)
    expect(ok('servers.update', { id: 's', patch: { ramMb: 4096 } }, 'admin')).not.toThrow()
  })
  it('jeder Befehl ist entweder bewusst gesperrt oder hat eine Rolle', () => {
    for (const c of Object.keys(commandRoles)) expect(typeof (isRemoteAllowed(c) ? commandRoles[c as CommandName] : 'blocked')).toBe('string')
  })
})
