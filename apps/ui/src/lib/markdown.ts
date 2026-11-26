/** Minimaler, sicherer Parser für das Changelog (nur Überschriften und Listen, kein HTML). */
export type Block = { type: 'h'; text: string } | { type: 'li'; text: string } | { type: 'p'; text: string }

export function parseChangelog(src: string): Block[] {
  const out: Block[] = []
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (h) out.push({ type: 'h', text: stripInline(h[1]!) })
    else if (li) out.push({ type: 'li', text: stripInline(li[1]!) })
    else out.push({ type: 'p', text: stripInline(line) })
  }
  return out
}

function stripInline(t: string): string {
  return t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}
