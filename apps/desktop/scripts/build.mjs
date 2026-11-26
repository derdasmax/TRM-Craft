import { build } from 'esbuild'
import { cpSync, mkdirSync, existsSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron', 'electron-updater', 'better-sqlite3', 'bufferutil', 'utf-8-validate'], sourcemap: true, outExtension: { '.js': '.cjs' } }
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' })
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' })
cpSync('static/splash.html', 'dist/splash.html')
if (existsSync('build/icon.png')) cpSync('build/icon.png', 'dist/icon.png')
// UI-Build einbinden, falls vorhanden
if (existsSync('../ui/dist')) cpSync('../ui/dist', 'dist/ui', { recursive: true })
console.log('desktop build ok')
