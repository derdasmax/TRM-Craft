import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * Speichert Geheimnisse (API-Keys, Tokens) ausschließlich verschlüsselt.
 * Unter Windows übernimmt Electron `safeStorage` die Verschlüsselung über DPAPI,
 * der Schlüssel gehört dem Windows-Benutzerkonto. Es gibt bewusst KEINEN Klartext-Fallback.
 */
export class SecretStore {
  private data: Record<string, string> = {}

  constructor(private readonly file: string, private readonly cipher: Cipher) {
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  private persist() {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  set(name: string, value: string): void {
    if (!this.cipher.isAvailable()) throw new Error('Die Windows-Verschlüsselung ist nicht verfügbar. Geheimnisse werden nicht unverschlüsselt gespeichert.')
    if (!value.trim()) throw new Error('Wert ist leer.')
    this.data[name] = this.cipher.encrypt(value.trim()).toString('base64')
    this.persist()
  }

  get(name: string): string | null {
    const raw = this.data[name]
    if (!raw) return null
    try {
      return this.cipher.decrypt(Buffer.from(raw, 'base64'))
    } catch {
      return null
    }
  }

  has(name: string): boolean {
    return !!this.data[name]
  }

  delete(name: string): void {
    delete this.data[name]
    this.persist()
  }
}
