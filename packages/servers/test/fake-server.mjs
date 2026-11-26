// Simuliert einen Minecraft-Server für Tests.
import { createInterface } from 'node:readline'
const log = (m) => console.log(`[12:00:00] [Server thread/INFO]: ${m}`)
if (process.env.FAKE_FAIL === 'immediately') { console.error('java.net.BindException: Address already in use'); process.exit(1) }
setTimeout(() => log('Done (0.1s)! For help, type "help"'), 50)
createInterface({ input: process.stdin }).on('line', (l) => {
  if (l === 'stop') { log('Stopping the server'); setTimeout(() => process.exit(0), 20) }
  else if (l === 'crash') process.exit(1)
  else if (l.startsWith('join ')) log(`${l.slice(5)} joined the game`)
  else if (l.startsWith('leave ')) log(`${l.slice(6)} left the game`)
  else if (l.startsWith('say ')) log(`[Server] ${l.slice(4)}`)
})
