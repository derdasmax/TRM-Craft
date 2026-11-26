/** Wandelt Konsolenzeilen mit ANSI-Farben oder Minecraft-§-Codes in gestylte Segmente. */
export interface Seg { text: string; color?: string; bold?: boolean; italic?: boolean; underline?: boolean }

const MC: Record<string, string> = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
  '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
}
const ANSI: Record<number, string> = {
  30: '#555555', 31: '#ff6b6b', 32: '#55d98d', 33: '#ffd166', 34: '#6ea8ff', 35: '#d68bff', 36: '#5fd7e6', 37: '#d4d7dc',
  90: '#7b8494', 91: '#ff8585', 92: '#7ee8a8', 93: '#ffe08a', 94: '#8dbaff', 95: '#e3a8ff', 96: '#8be8f2', 97: '#ffffff',
}

export function parseColored(input: string): Seg[] {
  const out: Seg[] = []
  let cur: Omit<Seg, 'text'> = {}
  let buf = ''
  const flush = () => { if (buf) { out.push({ text: buf, ...cur }); buf = '' } }
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([\d;]*)m|§([0-9a-fk-or])/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    buf += input.slice(last, m.index)
    last = m.index + m[0].length
    flush()
    if (m[1] !== undefined) {
      for (const n of (m[1] || '0').split(';').map(Number)) {
        if (n === 0) cur = {}
        else if (n === 1) cur = { ...cur, bold: true }
        else if (n === 3) cur = { ...cur, italic: true }
        else if (n === 4) cur = { ...cur, underline: true }
        else if (ANSI[n]) cur = { ...cur, color: ANSI[n] }
        else if (n === 39) cur = { ...cur, color: undefined }
      }
    } else {
      const c = m[2]!.toLowerCase()
      if (MC[c]) cur = { color: MC[c] }
      else if (c === 'l') cur = { ...cur, bold: true }
      else if (c === 'o') cur = { ...cur, italic: true }
      else if (c === 'n') cur = { ...cur, underline: true }
      else if (c === 'r') cur = {}
    }
  }
  buf += input.slice(last)
  flush()
  return out
}

export type Level = 'info' | 'warn' | 'error'
export function lineLevel(line: string): Level {
  if (/\/(ERROR|FATAL)\]|\bException\b|^\s+at\s|\[TRM-Craft\]/.test(line)) return 'error'
  if (/\/WARN\]/.test(line)) return 'warn'
  return 'info'
}
