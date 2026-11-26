import { build } from 'esbuild'
import { cpSync, mkdirSync, existsSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron', 'better-sqlite3'], sourcemap: true, outExtension: { '.js': '.cjs' } }
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' })
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' })
cpSync('static/splash.html', 'dist/splash.html')
// UI-Build einbinden, falls vorhanden
if (existsSync('../ui/dist')) cpSync('../ui/dist', 'dist/ui', { recursive: true })
console.log('desktop build ok')
