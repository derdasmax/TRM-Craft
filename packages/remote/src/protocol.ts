import { z } from 'zod'

/** Aktuelle Protokollversion. Steht in `hello` (App) und `welcome` (Webseite). */
export const PROTOCOL_VERSION = 1
/** Älteste Protokollversion, die diese App-Version noch versteht. */
export const MIN_PROTOCOL_VERSION = 1

const ID = z.string().regex(/^[\w-]{4,64}$/)
const SHA256 = z.string().regex(/^[0-9a-fA-F]{64}$/)
export const ROLE = z.enum(['owner', 'admin', 'moderator', 'viewer'])

/** Maschinenlesbare Fehlercodes in Antworten (`res`) und `upload.failed`. Die `error`-Texte sind für Menschen und deutsch. */
export const ERROR_CODES = [
  'disabled', // Fernzugriff ist in der App ausgeschaltet
  'unknown_command', // Befehl existiert nicht
  'local_only', // Befehl ist aus der Ferne gesperrt
  'forbidden', // Rolle reicht nicht
  'invalid_args', // Argumente oder Pfade ungültig
  'not_found', // Server oder Datei nicht gefunden
  'conflict', // existiert bereits
  'server_running', // Aktion braucht einen gestoppten Server
  'no_permission', // Gerät hat kein Upload-Recht
  'too_large', // über dem Größenlimit
  'unsupported_type', // Dateityp oder Server-Typ passt nicht
  'wrong_loader', // Mod/Modpack passt nicht zu Loader oder Version
  'checksum_mismatch', // SHA-256 stimmt nicht
  'network', // Verbindungsproblem beim Abruf
  'incompatible', // Protokollversionen passen nicht zusammen
  'internal', // alles andere
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export class RemoteError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); this.name = 'RemoteError' }
}

const RULES: [RegExp, ErrorCode][] = [
  [/Upload-Recht|Berechtigung/i, 'no_permission'],
  [/Stoppe den Server|Stoppe zuerst/i, 'server_running'],
  [/Prüfsumme/i, 'checksum_mismatch'],
  [/nicht gefunden|existiert nicht mehr/i, 'not_found'],
  [/existiert bereits/i, 'conflict'],
  [/größer als das Limit|zu groß/i, 'too_large'],
  [/gebaut, dieser Server|Modpack ist für|nutzt keinen unterstützten|brauchen einen/i, 'wrong_loader'],
  [/Dateityp nicht erlaubt|Unbekannte ZIP|nur zu einem Bedrock|unterstützt keine Mods|Für Bedrock nutze/i, 'unsupported_type'],
  [/ungültig|unzulässig|nicht erlaubt/i, 'invalid_args'],
  [/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Verbindung/i, 'network'],
]

/** Ordnet einer Fehlermeldung einen Code zu. */
export function classifyError(e: unknown): ErrorCode {
  if (e instanceof RemoteError) return e.code
  const m = e instanceof Error ? e.message : String(e)
  return RULES.find(([re]) => re.test(m))?.[1] ?? 'internal'
}

// ---------- Webseite → App ----------
export const InboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), protocolVersion: z.number().int(), minProtocolVersion: z.number().int().optional(), siteName: z.string().max(100).optional() }),
  z.object({ type: z.literal('cmd'), id: ID, command: z.string().max(60), args: z.unknown().optional(), role: ROLE, user: z.string().max(80).optional() }),
  z.object({ type: z.literal('subscribe'), events: z.array(z.string().max(40)).max(20), serverIds: z.array(z.string().max(40)).max(100).optional() }),
  z.object({ type: z.literal('sessions'), list: z.array(z.object({ id: z.string().max(64), name: z.string().max(80), role: ROLE, since: z.number() })).max(100) }),
  z.object({ type: z.literal('upload.begin'), uploadId: ID, serverId: z.string().max(40), fileName: z.string().min(1).max(200), size: z.number().int().positive(), sha256: SHA256, restartAfter: z.boolean().optional(), uploader: z.string().max(80).optional() }),
  z.object({ type: z.literal('upload.chunk'), uploadId: ID, offset: z.number().int().min(0), data: z.string().max(6_000_000) }),
  z.object({ type: z.literal('upload.end'), uploadId: ID }),
  z.object({ type: z.literal('upload.cancel'), uploadId: ID }),
  z.object({ type: z.literal('upload.fetch'), uploadId: ID, serverId: z.string().max(40), fileName: z.string().min(1).max(200), size: z.number().int().positive(), sha256: SHA256, url: z.string().url().max(2000), restartAfter: z.boolean().optional(), uploader: z.string().max(80).optional() }),
  z.object({ type: z.literal('ping') }),
])
export type Inbound = z.infer<typeof InboundSchema>

// ---------- App → Webseite ----------
export const ServerSummarySchema = z.object({
  id: z.string(), name: z.string(), edition: z.enum(['java', 'bedrock']), loader: z.string(), mcVersion: z.string(), status: z.enum(['stopped', 'starting', 'running', 'stopping', 'crashed']),
  players: z.array(z.string()), port: z.number().int(), uptimeMs: z.number().nullable(),
  cpu: z.number().optional(), ramMb: z.number().optional(), tps: z.number().optional(),
  crash: z.object({ kind: z.string(), message: z.string() }).optional(),
})
export type ServerSummary = z.infer<typeof ServerSummarySchema>

export const ServerEventSchema = z.object({
  id: z.string(), name: z.string(), kind: z.enum(['started', 'stopped', 'crashed', 'join', 'leave']), player: z.string().optional(), detail: z.string().optional(),
})

export const OutboundSchema = z.union([
  z.object({ type: z.literal('hello'), protocolVersion: z.number().int(), minProtocolVersion: z.number().int(), deviceId: z.string().optional(), deviceName: z.string(), appVersion: z.string(), platform: z.string(), canUpload: z.boolean(), transport: z.enum(['websocket', 'polling']), servers: z.array(ServerSummarySchema) }),
  z.object({ type: z.literal('snapshot'), at: z.number(), servers: z.array(ServerSummarySchema) }),
  z.object({ type: z.literal('res'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ type: z.literal('res'), id: z.string(), ok: z.literal(false), error: z.string(), code: z.enum(ERROR_CODES) }),
  z.object({ type: z.literal('event'), event: z.string(), payload: z.unknown() }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('upload.ready'), uploadId: z.string(), received: z.number().int() }),
  z.object({ type: z.literal('upload.ack'), uploadId: z.string(), received: z.number().int() }),
  z.object({ type: z.literal('upload.done'), uploadId: z.string(), kind: z.string(), warnings: z.array(z.string()) }),
  z.object({ type: z.literal('upload.failed'), uploadId: z.string(), error: z.string(), code: z.enum(ERROR_CODES) }),
])
export type Outbound = z.infer<typeof OutboundSchema>

export const PairResponseSchema = z.object({
  deviceToken: z.string().min(16).max(4096),
  deviceId: z.string().max(100),
  siteName: z.string().max(100).optional(),
  perms: z.object({ upload: z.boolean().default(false) }).default({}),
})
export type PairResponse = z.infer<typeof PairResponseSchema>

/** Antwort der Webseite beim Start der Kopplung "von der App aus". */
export const PairStartSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9-]{4,24}$/), pollId: z.string().regex(/^[\w-]{8,80}$/), expiresInSec: z.number().int().min(10).max(3600) })
export const PairStatusSchema = z.union([z.object({ status: z.literal('pending') }), z.object({ status: z.literal('paired') }).merge(PairResponseSchema)])

export const PollSessionSchema = z.object({ sessionId: z.string().regex(/^[\w-]{8,80}$/) })
export const PollResponseSchema = z.object({ messages: z.array(z.unknown()).max(500) })

/** Maximal erlaubte Dateiendungen für Uploads. */
export const UPLOAD_EXTENSIONS = ['.jar', '.zip', '.mrpack', '.mcpack', '.mcaddon'] as const
