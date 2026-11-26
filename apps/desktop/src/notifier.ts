import { Notification } from 'electron'
import { diffServerEvents, discordPayload, isDiscordWebhook, sendDiscord, type ServerEvent, type Snap } from '@trm/servers'
import type { ServerView } from '@trm/core'

interface Deps {
  desktopEnabled: () => boolean
  webhook: (serverId: string) => string | null
  log: (serverId: string, line: string) => void
}

const TEXT: Record<ServerEvent['type'], (n: string, e: ServerEvent) => string> = {
  started: (n) => `${n} ist online.`,
  stopped: (n) => `${n} wurde gestoppt.`,
  crashed: (n) => `${n} ist abgestürzt.`,
  join: (n, e) => `${(e as { player: string }).player} hat ${n} betreten.`,
  leave: (n, e) => `${(e as { player: string }).player} hat ${n} verlassen.`,
}

/** Verteilt Server-Ereignisse an Windows-Benachrichtigungen und Discord-Webhooks (je Server einstellbar). */
export class Notifier {
  private prev = new Map<string, Snap>()
  constructor(private readonly d: Deps) {}

  onStatus(v: ServerView): void {
    const events = diffServerEvents(this.prev.get(v.id), { status: v.status, players: v.players })
    this.prev.set(v.id, { status: v.status, players: v.players })
    for (const e of events) {
      const social = e.type === 'join' || e.type === 'leave'
      if (social && !v.notify.joins) continue
      if (v.notify.desktop && this.d.desktopEnabled() && e.type !== 'leave' && e.type !== 'stopped') new Notification({ title: 'TRM-Craft', body: TEXT[e.type](v.name, e) }).show()
      if (v.notify.discord) void this.discord(v, e)
    }
  }

  forget(id: string) { this.prev.delete(id) }

  private async discord(v: ServerView, e: ServerEvent) {
    const url = this.d.webhook(v.id)
    if (!url || !isDiscordWebhook(url)) return
    try { await sendDiscord(url, discordPayload(v.name, e, e.type === 'crashed' ? v.lastCrash?.message : undefined)) }
    catch (err) { this.d.log(v.id, `[TRM-Craft] Discord: ${(err as Error).message}`) }
  }

  async test(v: ServerView): Promise<void> {
    const url = this.d.webhook(v.id)
    if (!url) throw new Error('Es ist kein Discord-Webhook gespeichert.')
    await sendDiscord(url, discordPayload(v.name, { type: 'info', text: 'TRM-Craft ist verbunden. Dies ist eine Testnachricht.' }))
  }
}
