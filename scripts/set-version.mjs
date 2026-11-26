// Setzt die Version in apps/desktop/package.json (nur im CI-Build, wird nicht committet).
import { readFileSync, writeFileSync } from 'node:fs'
const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(version ?? '')) throw new Error(`Ungültige Version: ${version}`)
const p = 'apps/desktop/package.json'
const pkg = JSON.parse(readFileSync(p, 'utf8'))
pkg.version = version
writeFileSync(p, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`apps/desktop/package.json -> ${version}`)
