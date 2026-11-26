import { execFile, type ExecFileException } from 'node:child_process'

export type Proto = 'TCP' | 'UDP'
const NAME = /^[A-Za-z0-9 _.-]{1,80}$/

export const ruleName = (serverId: string, proto: Proto, port: number) => `TRM-Craft ${serverId} ${proto} ${port}`

function check(name: string, port: number) {
  if (!NAME.test(name)) throw new Error('Ungültiger Regelname.')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Ungültiger Port.')
}

export const addArgs = (name: string, proto: Proto, port: number) => {
  check(name, port)
  return ['advfirewall', 'firewall', 'add', 'rule', `name=${name}`, 'dir=in', 'action=allow', `protocol=${proto}`, `localport=${port}`, 'profile=private,public']
}
export const deleteArgs = (name: string) => { check(name, 1024); return ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`] }
export const showArgs = (name: string) => { check(name, 1024); return ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`] }

/** Verpackt netsh-Argumente für eine UAC-Abfrage (Administratorrechte). Alle Teile wurden vorher validiert. */
export function elevatedPowerShell(args: string[]): string[] {
  const list = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  return ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath netsh -ArgumentList ${list} -Verb RunAs -Wait -WindowStyle Hidden`]
}

export type Exec = (cmd: string, args: string[]) => Promise<{ code: number }>
const defaultExec: Exec = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 60_000 }, (e: ExecFileException | null) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 2) : 0 })))

export class Firewall {
  constructor(private readonly exec: Exec = defaultExec, private readonly platform: NodeJS.Platform = process.platform) {}
  get supported() { return this.platform === 'win32' }

  async exists(name: string): Promise<boolean> {
    if (!this.supported) return false
    return (await this.exec('netsh', showArgs(name))).code === 0
  }

  async add(serverId: string, rules: { proto: Proto; port: number }[]): Promise<void> {
    if (!this.supported) throw new Error('Firewall-Regeln gibt es nur unter Windows.')
    for (const r of rules) {
      const name = ruleName(serverId, r.proto, r.port)
      if (await this.exists(name)) continue
      await this.exec('powershell.exe', elevatedPowerShell(addArgs(name, r.proto, r.port)))
      if (!(await this.exists(name))) throw new Error('Die Firewall-Regel wurde nicht angelegt (Administrator-Abfrage abgelehnt?).')
    }
  }

  async remove(serverId: string, rules: { proto: Proto; port: number }[]): Promise<void> {
    if (!this.supported) throw new Error('Firewall-Regeln gibt es nur unter Windows.')
    for (const r of rules) {
      const name = ruleName(serverId, r.proto, r.port)
      if (!(await this.exists(name))) continue
      await this.exec('powershell.exe', elevatedPowerShell(deleteArgs(name)))
    }
  }
}
