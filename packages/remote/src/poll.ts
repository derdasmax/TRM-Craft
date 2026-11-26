import type { SocketLike } from './client'
import { PollResponseSchema, PollSessionSchema } from './protocol'

/**
 * HTTPS-Long-Polling als Fallback, falls WebSockets blockiert sind (Firmen-Proxy, Schul-WLAN).
 * Verhält sich nach außen wie ein WebSocket, damit der Client nichts davon merkt.
 *
 *   POST {base}/api/agent/session            -> { sessionId }
 *   GET  {base}/api/agent/poll?session=ID    -> { messages: [...] }   (wartet bis ca. 25 s, leer = Zeitüberschreitung)
 *   POST {base}/api/agent/send?session=ID    <- { messages: [...] }   (204)
 * Alle Anfragen tragen `Authorization: Bearer <deviceToken>`. 401/403 bedeuten: Gerät abgelehnt.
 */
export class LongPollSocket implements SocketLike {
  private handlers: Record<string, ((...a: any[]) => void)[]> = {}
  private session = ''
  private closed = false
  private outbox: string[] = []
  private flushing = false
  private abort = new AbortController()

  constructor(private readonly base: string, private readonly token: string, private readonly f: typeof fetch = fetch, private readonly waitSec = 25) {
    // Erst nach dem Registrieren der Handler starten (der Client hängt sie direkt nach dem Erzeugen an).
    queueMicrotask(() => void this.run())
  }

  on(event: 'open' | 'message' | 'close' | 'error' | 'pong', cb: (...a: any[]) => void): void {
    ;(this.handlers[event] ??= []).push(cb)
  }
  private emit(event: string, ...a: unknown[]) { for (const h of this.handlers[event] ?? []) h(...a) }

  private headers() { return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' } }

  private fail(status: number | null) {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    this.emit('close', status === 401 || status === 403 ? 4401 : 1006)
  }

  private async run() {
    try {
      const res = await this.f(`${this.base}/api/agent/session`, { method: 'POST', headers: this.headers(), body: '{}', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]) })
      if (!res.ok) return this.fail(res.status)
      this.session = PollSessionSchema.parse(await res.json()).sessionId
    } catch { return this.fail(null) }
    this.emit('open')
    while (!this.closed) {
      try {
        const res = await this.f(`${this.base}/api/agent/poll?session=${encodeURIComponent(this.session)}&wait=${this.waitSec}`, { headers: this.headers(), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout((this.waitSec + 15) * 1000)]) })
        if (!res.ok) return this.fail(res.status)
        const { messages } = PollResponseSchema.parse(await res.json())
        this.emit('pong') // Lebenszeichen, auch bei leerer Antwort
        for (const m of messages) this.emit('message', typeof m === 'string' ? m : JSON.stringify(m))
      } catch { return this.fail(null) }
    }
  }

  send(data: string): void {
    if (this.closed) throw new Error('Verbindung geschlossen.')
    this.outbox.push(data)
    void this.flush()
  }

  private async flush() {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.outbox.length && !this.closed) {
        const batch = this.outbox.splice(0, 50)
        const res = await this.f(`${this.base}/api/agent/send?session=${encodeURIComponent(this.session)}`, { method: 'POST', headers: this.headers(), body: `{"messages":[${batch.join(',')}]}`, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]) })
        if (!res.ok) return this.fail(res.status)
      }
    } catch { this.fail(null) } finally { this.flushing = false }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
  }

  terminate(): void { this.close() }
}
