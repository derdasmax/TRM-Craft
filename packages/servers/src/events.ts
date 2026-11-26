import type { ServerStatus } from '@trm/core'

export interface Snap { status: ServerStatus; players: string[] }
export type ServerEvent =
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'crashed' }
  | { type: 'join'; player: string }
  | { type: 'leave'; player: string }

/** Vergleicht zwei Zustände und liefert die Ereignisse für Benachrichtigungen. */
export function diffServerEvents(prev: Snap | undefined, next: Snap): ServerEvent[] {
  const ev: ServerEvent[] = []
  const was = prev?.status ?? 'stopped'
  if (was !== next.status) {
    if (next.status === 'running') ev.push({ type: 'started' })
    else if (next.status === 'crashed') ev.push({ type: 'crashed' })
    else if (next.status === 'stopped' && (was === 'running' || was === 'stopping')) ev.push({ type: 'stopped' })
  }
  const before = new Set(prev?.players ?? [])
  const after = new Set(next.players)
  for (const p of after) if (!before.has(p)) ev.push({ type: 'join', player: p })
  for (const p of before) if (!after.has(p)) ev.push({ type: 'leave', player: p })
  return ev
}

const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']

/** Nur echte Discord-Webhook-URLs zulassen (verhindert Anfragen an beliebige Hosts). */
export function isDiscordWebhook(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && DISCORD_HOSTS.includes(u.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)
  } catch { return false }
}

const COLORS = { started: 0x34d399, stopped: 0x8c94a0, crashed: 0xf87171, join: 0x6ea8ff, leave: 0x8c94a0, info: 0xfbbf24 }

export function discordPayload(server: string, e: ServerEvent | { type: 'info'; text: string }, detail?: string) {
  const text =
    e.type === 'started' ? `**${server}** ist online.` :
    e.type === 'stopped' ? `**${server}** wurde gestoppt.` :
    e.type === 'crashed' ? `**${server}** ist abgestürzt.${detail ? `\n${detail}` : ''}` :
    e.type === 'join' ? `${e.player} hat **${server}** betreten.` :
    e.type === 'leave' ? `${e.player} hat **${server}** verlassen.` : e.text
  return { username: 'TRM-Craft', allowed_mentions: { parse: [] as string[] }, embeds: [{ description: text.slice(0, 1800), color: COLORS[e.type] }] }
}

export async function sendDiscord(url: string, payload: unknown, f: typeof fetch = fetch): Promise<void> {
  if (!isDiscordWebhook(url)) throw new Error('Das ist keine gültige Discord-Webhook-URL.')
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  if (!res.ok) throw new Error(`Discord hat die Nachricht abgelehnt (${res.status}).`)
}
