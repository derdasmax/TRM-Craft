import { z } from 'zod'

/** Aktuelle Protokollversion der App-API. Steht in `GET /api/v1/info` und in der WebSocket-`hello`-Nachricht. */
export const PROTOCOL_VERSION = 2
/** Älteste Protokollversion, die diese App-Version noch bedient. */
export const MIN_PROTOCOL_VERSION = 2

export const API_BASE = '/api/v1'
export const ROLE = z.enum(['owner', 'admin', 'moderator', 'viewer'])

/** Maschinenlesbare Fehlercodes (Feld `code`). Die `error`-Texte sind für Menschen und deutsch. */
export const ERROR_CODES = [
  'unauthorized', // Token fehlt, ist ungültig oder abgelaufen
  'disabled', // Fernzugriff ist in der App ausgeschaltet
  'origin_not_allowed', // Browser-Origin ist nicht freigegeben
  'host_not_allowed', // unerwarteter Host-Header
  'rate_limited', // zu viele Anfragen oder Fehlversuche
  'unknown_command',
  'local_only', // Befehl ist aus der Ferne gesperrt
  'forbidden', // Rolle reicht nicht
  'invalid_args',
  'not_found',
  'conflict', // existiert bereits oder Offset passt nicht
  'server_running',
  'no_permission', // Gerät hat kein Upload-Recht
  'too_large',
  'unsupported_type',
  'wrong_loader',
  'checksum_mismatch',
  'network',
  'incompatible',
  'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export const ErrorCodeSchema = z.enum(ERROR_CODES)

/** HTTP-Status je Fehlercode. */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401, disabled: 503, origin_not_allowed: 403, host_not_allowed: 421, rate_limited: 429, unknown_command: 404, local_only: 403, forbidden: 403,
  invalid_args: 400, not_found: 404, conflict: 409, server_running: 409, no_permission: 403, too_large: 413, unsupported_type: 415, wrong_loader: 422,
  checksum_mismatch: 422, network: 502, incompatible: 426, internal: 500,
}

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

// ---------- Gemeinsame Bausteine ----------
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

export const PermsSchema = z.object({ upload: z.boolean() })

// ---------- REST ----------
export const InfoSchema = z.object({ name: z.literal('TRM-Craft'), appVersion: z.string(), protocolVersion: z.number().int(), minProtocolVersion: z.number().int(), deviceName: z.string(), tunnel: z.boolean() })
/** Kopplung Weg A: Die Webseite sendet den in der App angezeigten Code. */
export const PairRequestSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9-]{4,24}$/), siteName: z.string().max(80).optional() })
export const PairResponseSchema = z.object({ deviceToken: z.string(), deviceId: z.string(), deviceName: z.string(), perms: PermsSchema, maxRole: z.enum(['viewer', 'moderator', 'admin']) })
export const SessionRequestSchema = z.object({ user: z.string().min(1).max(80), role: ROLE, ttlSec: z.number().int().min(60).max(3600).optional() })
export const SessionResponseSchema = z.object({ sessionToken: z.string(), expiresAt: z.number(), role: ROLE, perms: PermsSchema })
export const MeSchema = z.object({ kind: z.enum(['device', 'session']), role: ROLE, perms: PermsSchema, user: z.string().optional(), expiresAt: z.number().optional() })
export const CmdRequestSchema = z.object({ command: z.string().max(60), args: z.unknown().optional() })
export const CmdResponseSchema = z.union([z.object({ ok: z.literal(true), result: z.unknown() }), z.object({ ok: z.literal(false), error: z.string(), code: ErrorCodeSchema })])
export const ErrorResponseSchema = z.object({ ok: z.literal(false), error: z.string(), code: ErrorCodeSchema })

const ID = z.string().regex(/^[\w-]{4,64}$/)
const SHA256 = z.string().regex(/^[0-9a-fA-F]{64}$/)
export const UploadBeginRequestSchema = z.object({ uploadId: ID.optional(), serverId: z.string().max(40), fileName: z.string().min(1).max(200), size: z.number().int().positive(), sha256: SHA256, restartAfter: z.boolean().optional() })
export const UploadBeginResponseSchema = z.object({ uploadId: z.string(), received: z.number().int(), chunkSize: z.number().int() })
export const UploadChunkResponseSchema = z.object({ received: z.number().int() })
export const UploadFinishResponseSchema = z.object({ kind: z.string(), warnings: z.array(z.string()) })
export const UploadStatusSchema = z.object({ uploadId: z.string(), status: z.enum(['receiving', 'done', 'failed', 'undone']), received: z.number().int(), size: z.number().int(), error: z.string().optional() })
/** Empfohlene und maximale Chunk-Größe in Bytes. */
export const CHUNK_SIZE = 1_048_576
export const MAX_CHUNK = 8 * 1_048_576

// ---------- WebSocket ----------
/** Browser → App. Die erste Nachricht muss `auth` sein (innerhalb von 5 Sekunden). */
export const WsInboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(8).max(200) }),
  z.object({ type: z.literal('cmd'), id: ID, command: z.string().max(60), args: z.unknown().optional() }),
  z.object({ type: z.literal('subscribe'), events: z.array(z.string().max(40)).max(20), serverIds: z.array(z.string().max(40)).max(100).optional() }),
  z.object({ type: z.literal('ping') }),
])
export type WsInbound = z.infer<typeof WsInboundSchema>

/** App → Browser. */
export const WsOutboundSchema = z.union([
  z.object({ type: z.literal('hello'), protocolVersion: z.number().int(), minProtocolVersion: z.number().int(), appVersion: z.string(), deviceName: z.string(), role: ROLE, perms: PermsSchema, user: z.string(), servers: z.array(ServerSummarySchema) }),
  z.object({ type: z.literal('snapshot'), at: z.number(), servers: z.array(ServerSummarySchema) }),
  z.object({ type: z.literal('res'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ type: z.literal('res'), id: z.string(), ok: z.literal(false), error: z.string(), code: ErrorCodeSchema }),
  z.object({ type: z.literal('event'), event: z.string(), payload: z.unknown() }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), error: z.string(), code: ErrorCodeSchema }),
])
export type WsOutbound = z.infer<typeof WsOutboundSchema>

/** Erlaubte Dateiendungen für Uploads. */
export const UPLOAD_EXTENSIONS = ['.jar', '.zip', '.mrpack', '.mcpack', '.mcaddon'] as const
