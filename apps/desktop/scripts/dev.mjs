import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
await import('./build.mjs')
const electron = createRequire(import.meta.url)('electron')
const p = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, TRM_DEV_URL: process.env.TRM_DEV_URL ?? 'http://localhost:5173' } })
p.on('exit', (c) => process.exit(c ?? 0))
