import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CmdRequestSchema, CmdResponseSchema, ERROR_CODES, ErrorResponseSchema, InfoSchema, MeSchema, MIN_PROTOCOL_VERSION, PairRequestSchema, PairResponseSchema, PROTOCOL_VERSION, ServerSummarySchema,
  SessionRequestSchema, SessionResponseSchema, UploadBeginRequestSchema, UploadBeginResponseSchema, UploadChunkResponseSchema, UploadFinishResponseSchema, UploadStatusSchema, UPLOAD_EXTENSIONS, WsInboundSchema, WsOutboundSchema, API_BASE,
} from './protocol'

const j = (s: Parameters<typeof zodToJsonSchema>[0], name: string) => {
  const r = zodToJsonSchema(s, { name, $refStrategy: 'none', target: 'jsonSchema7' }) as { definitions?: Record<string, unknown> }
  return r.definitions?.[name]
}

/** JSON-Schema aller Nachrichten des Remote-Protokolls. Wird in `docs/remote-api.schema.json` abgelegt. */
export function buildSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://trm-craft/remote-api.schema.json',
    title: 'TRM-Craft Remote-API',
    description: 'Schemas der App-eigenen Remote-API (HTTPS-REST + WebSocket). Quelle: packages/remote/src/protocol.ts. Neu erzeugen mit UPDATE_SCHEMA=1.',
    protocolVersion: PROTOCOL_VERSION,
    minProtocolVersion: MIN_PROTOCOL_VERSION,
    apiBase: API_BASE,
    errorCodes: ERROR_CODES,
    uploadExtensions: UPLOAD_EXTENSIONS,
    definitions: {
      Info: j(InfoSchema, 'Info'),
      PairRequest: j(PairRequestSchema, 'PairRequest'),
      PairResponse: j(PairResponseSchema, 'PairResponse'),
      SessionRequest: j(SessionRequestSchema, 'SessionRequest'),
      SessionResponse: j(SessionResponseSchema, 'SessionResponse'),
      Me: j(MeSchema, 'Me'),
      CmdRequest: j(CmdRequestSchema, 'CmdRequest'),
      CmdResponse: j(CmdResponseSchema, 'CmdResponse'),
      ErrorResponse: j(ErrorResponseSchema, 'ErrorResponse'),
      ServerSummary: j(ServerSummarySchema, 'ServerSummary'),
      UploadBeginRequest: j(UploadBeginRequestSchema, 'UploadBeginRequest'),
      UploadBeginResponse: j(UploadBeginResponseSchema, 'UploadBeginResponse'),
      UploadChunkResponse: j(UploadChunkResponseSchema, 'UploadChunkResponse'),
      UploadFinishResponse: j(UploadFinishResponseSchema, 'UploadFinishResponse'),
      UploadStatus: j(UploadStatusSchema, 'UploadStatus'),
      /** Browser → App (WebSocket) */
      WsInbound: j(WsInboundSchema, 'WsInbound'),
      /** App → Browser (WebSocket) */
      WsOutbound: j(WsOutboundSchema, 'WsOutbound'),
    },
  }
}
