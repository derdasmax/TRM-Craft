// Berechnet die nächste Version aus Conventional-Commit-Messages.
// Regeln: BREAKING (`!:` oder "BREAKING CHANGE") = Major, feat = Minor,
// fix/perf/refactor = Patch. chore/docs/test/ci/style/build lösen keinen Release aus.

const RELEASE_TYPES = new Set(['feat', 'fix', 'perf', 'refactor'])
const HEADER = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/

export function parseCommit(message) {
  const [subject = '', ...rest] = message.trim().split('\n')
  const m = HEADER.exec(subject.trim())
  const body = rest.join('\n')
  const breaking = !!(m && m[3]) || /BREAKING[ -]CHANGE/.test(body) || /\bBREAKING\b/.test(subject)
  if (!m) return { type: 'other', scope: null, subject: subject.trim(), breaking }
  return { type: m[1].toLowerCase(), scope: m[2] ? m[2].slice(1, -1) : null, subject: m[4].trim(), breaking }
}

export function bumpLevel(commits) {
  let level = null
  for (const c of commits) {
    if (c.breaking) return 'major'
    if (c.type === 'feat') level = 'minor'
    else if (RELEASE_TYPES.has(c.type) && level !== 'minor') level = 'patch'
  }
  return level
}

export function bump(version, level) {
  const [maj, min, pat] = version.split('-')[0].split('.').map(Number)
  if (level === 'major') return `${maj + 1}.0.0`
  if (level === 'minor') return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}

/**
 * @param lastStable  letzte stabile Version (z. B. "1.4.2"), oder null beim ersten Release
 * @param messages    Commit-Messages seit dem letzten stabilen Tag
 * @param channel     "stable" | "beta"
 * @param existingBetaTags  vorhandene Beta-Versionen (z. B. ["1.5.0-beta.1"])
 * @returns Version oder null, wenn kein Release nötig ist
 */
export function nextVersion({ lastStable, messages, channel, existingBetaTags = [] }) {
  const commits = messages.map(parseCommit)
  if (lastStable === null) {
    return channel === 'beta' ? '0.1.0-beta.1' : '0.1.0'
  }
  const level = bumpLevel(commits)
  if (!level) return null
  const base = bump(lastStable, level)
  if (channel === 'stable') return base
  const n = existingBetaTags
    .filter((t) => t.startsWith(`${base}-beta.`))
    .map((t) => Number(t.split('-beta.')[1]))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${base}-beta.${n + 1}`
}

const SECTIONS = [
  ['feat', 'Neu'],
  ['fix', 'Fehlerbehebungen'],
  ['perf', 'Performance'],
  ['refactor', 'Überarbeitet'],
]

export function changelog(messages) {
  const commits = messages.map(parseCommit)
  const out = []
  const breaking = commits.filter((c) => c.breaking)
  if (breaking.length) out.push('### Breaking Changes', ...breaking.map((c) => `- ${c.subject}`), '')
  for (const [type, title] of SECTIONS) {
    const items = commits.filter((c) => c.type === type && !c.breaking)
    if (items.length) out.push(`### ${title}`, ...items.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject}`), '')
  }
  return out.join('\n').trim() || 'Kleinere Verbesserungen.'
}
