import { z } from 'zod'

/** Protokollversion der Remote-API. Wird im `hello` gemeldet. */
export const PROTOCOL_VERSION = 1

const ID = z.string().regex(/^[\w-]{4,64}$/)
const SHA256 = z.string().regex(/^[0-9a-fA-F]{64}$/)
export const ROLE = z.enum(['owner', 'admin', 'moderator', 'viewer'])

/** Nachrichten von der Webseite an die App. */
export const InboundSchema = z.discriminatedUnion('type', [
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

export const PairResponseSchema = z.object({
  deviceToken: z.string().min(16).max(4096),
  deviceId: z.string().max(100),
  siteName: z.string().max(100).optional(),
  perms: z.object({ upload: z.boolean().default(false) }).default({}),
})
export type PairResponse = z.infer<typeof PairResponseSchema>

/** Maximal erlaubte Dateiendungen für Uploads. */
export const UPLOAD_EXTENSIONS = ['.jar', '.zip', '.mrpack', '.mcpack', '.mcaddon'] as const
