import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { join } from 'node:path'

let tray: Tray | null = null

export function createTray(getWin: () => BrowserWindow | null, onCheckUpdates: () => void, onQuit: () => void) {
  const icon = nativeImage.createFromPath(join(__dirname, 'icon.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip(`TRM-Craft ${app.getVersion()}`)
  const show = () => {
    const w = getWin()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'TRM-Craft öffnen', click: show },
      { label: 'Nach Updates suchen', click: onCheckUpdates },
      { type: 'separator' },
      { label: 'Beenden', click: onQuit },
    ]),
  )
  tray.on('click', show)
  return tray
}
