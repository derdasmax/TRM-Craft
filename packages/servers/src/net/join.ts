import type { DomainConfig, JoinInfo, ServerRecord } from '@trm/core'

const withPort = (host: string, port: number, def: number) => (port === def ? host : `${host}:${port}`)

/** Baut die Adressen, die Freunde zum Beitreten brauchen. */
export function buildJoinInfo(r: ServerRecord, o: { domain?: DomainConfig | null; publicIp?: string | null; tunnel?: string | null }): JoinInfo {
  const host = o.domain?.host ?? o.publicIp ?? null
  const out: JoinInfo = {}
  if (r.edition === 'bedrock') {
    if (host) out.bedrock = { address: host, port: r.port }
    return out
  }
  if (o.tunnel) out.java = { address: o.tunnel, note: 'Tunnel' }
  else if (host) out.java = o.domain?.srv ? { address: host } : { address: withPort(host, r.port, 25565) }
  if (r.crossplay && r.bedrockPort && host) out.bedrock = { address: host, port: r.bedrockPort }
  return out
}
