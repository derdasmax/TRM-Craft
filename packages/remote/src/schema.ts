import { zodToJsonSchema } from 'zod-to-json-schema'
import { ERROR_CODES, InboundSchema, MIN_PROTOCOL_VERSION, OutboundSchema, PairResponseSchema, PairStartSchema, PairStatusSchema, PollResponseSchema, PollSessionSchema, PROTOCOL_VERSION, UPLOAD_EXTENSIONS } from './protocol'

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
    description: 'Nachrichten zwischen der TRM-Craft-App und dem TRM-Relay (Webseite). Quelle: packages/remote/src/protocol.ts. Neu erzeugen mit UPDATE_SCHEMA=1.',
    protocolVersion: PROTOCOL_VERSION,
    minProtocolVersion: MIN_PROTOCOL_VERSION,
    errorCodes: ERROR_CODES,
    uploadExtensions: UPLOAD_EXTENSIONS,
    definitions: {
      /** Webseite → App (WebSocket-Textnachricht bzw. Eintrag in `messages` beim Polling) */
      Inbound: j(InboundSchema, 'Inbound'),
      /** App → Webseite */
      Outbound: j(OutboundSchema, 'Outbound'),
      /** Antwort von POST /api/devices/pair und GET /api/devices/pair/status (paired) */
      PairResponse: j(PairResponseSchema, 'PairResponse'),
      /** Antwort von POST /api/devices/pair/start */
      PairStart: j(PairStartSchema, 'PairStart'),
      PairStatus: j(PairStatusSchema, 'PairStatus'),
      /** Long-Polling */
      PollSession: j(PollSessionSchema, 'PollSession'),
      PollResponse: j(PollResponseSchema, 'PollResponse'),
    },
  }
}
