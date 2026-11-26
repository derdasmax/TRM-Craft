import { roleAllows, type CommandName, type Role } from '@trm/core'

/**
 * Befehle, die NIE aus der Ferne laufen dürfen: Sie betreffen den lokalen PC (Fenster, Dialoge, Geheimnisse, Updates,
 * Kopplung) oder nehmen lokale Dateipfade entgegen, die ein Angreifer sonst frei wählen könnte.
 */
const LOCAL_ONLY_PREFIX = ['window.', 'shell.', 'dialog.', 'secrets.', 'remote.']
const LOCAL_ONLY = new Set<string>(['updater.installNow', 'updater.skipCountdown', 'mods.addFiles', 'files.upload', 'worlds.import', 'worlds.export', 'net.firewall.add', 'net.firewall.remove', 'servers.import'])

const RANK: Record<Role, number> = { viewer: 0, moderator: 1, admin: 2, owner: 3 }

export interface GuardConfig { maxRole: Role; enabled: boolean }

export function isRemoteAllowed(command: string): boolean {
  return !LOCAL_ONLY.has(command) && !LOCAL_ONLY_PREFIX.some((p) => command.startsWith(p))
}

/** Prüft Befehl, Rolle und Argumente. Wirft eine verständliche Fehlermeldung, wenn etwas nicht erlaubt ist. */
export function authorizeRemote(command: string, args: unknown, role: Role, cfg: GuardConfig, known: (c: string) => c is CommandName): asserts command is CommandName {
  if (!cfg.enabled) throw new Error('Fernzugriff ist ausgeschaltet.')
  if (!known(command)) throw new Error(`Unbekannter Befehl: ${command}`)
  if (!isRemoteAllowed(command)) throw new Error('Dieser Befehl ist aus der Ferne nicht erlaubt.')
  // Die Rolle wird durch die lokale Obergrenze gekappt.
  const effective: Role = RANK[role] > RANK[cfg.maxRole] ? cfg.maxRole : role
  if (!roleAllows(effective, command)) throw new Error('Dafür fehlt die Berechtigung.')
  const a = (args ?? {}) as Record<string, unknown>
  // Lokale Pfade in Argumenten sind aus der Ferne tabu.
  if (command === 'servers.create' && (a.input as Record<string, unknown> | undefined)?.worldZip) throw new Error('Welt-Import per lokalem Pfad ist aus der Ferne nicht erlaubt. Nutze den Upload.')
  if (command === 'modpacks.install' && (a.source as { type?: string } | undefined)?.type === 'file') throw new Error('Modpack-Dateien lädst du über den Upload hoch.')
  if (command === 'servers.update' && (a.patch as { backup?: { dir?: unknown } } | undefined)?.backup?.dir !== undefined) throw new Error('Der Backup-Ordner kann nur lokal geändert werden.')
}
