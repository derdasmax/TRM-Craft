// Ermittelt Version + Changelog für den aktuellen Push. Aufruf in CI:
//   node scripts/release.mjs --channel stable|beta
// Schreibt `version`, `skip` und `tag` nach $GITHUB_OUTPUT und die Notes nach release-notes.md.
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { changelog, nextVersion } from './version.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const channel = process.argv.includes('--channel') ? process.argv[process.argv.indexOf('--channel') + 1] : 'stable'
if (!['stable', 'beta'].includes(channel)) throw new Error(`Unbekannter Kanal: ${channel}`)

const semver = (v) => v.split('-')[0].split('.').map(Number)
const cmp = (a, b) => {
  const x = semver(a), y = semver(b)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean).map((t) => t.slice(1))
const stable = tags.filter((t) => !t.includes('-')).sort(cmp)
const lastStable = stable.length ? stable[stable.length - 1] : null
const range = lastStable ? [`v${lastStable}..HEAD`] : ['HEAD']
const messages = git('log', ...range, '--format=%B%x1e').split('\x1e').map((m) => m.trim()).filter(Boolean)

const version = nextVersion({ lastStable, messages, channel, existingBetaTags: tags.filter((t) => t.includes('-beta.')) })
const out = process.env.GITHUB_OUTPUT
const emit = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`))

if (!version) {
  console.log('Keine release-relevanten Commits (feat/fix/perf/refactor). Kein Release.')
  emit('skip', 'true')
} else {
  writeFileSync('release-notes.md', `${changelog(messages)}\n`)
  emit('skip', 'false')
  emit('version', version)
  emit('tag', `v${version}`)
  console.log(`Nächste Version: ${version} (Kanal ${channel}, zuletzt stabil ${lastStable ?? 'keine'})`)
}
