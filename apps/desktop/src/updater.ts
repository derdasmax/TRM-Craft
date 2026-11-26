import { app, Notification } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { isBadVersion, type Settings, type UpdaterState } from '@trm/core'
import { activeServerCount, announceAll, stopAll } from './lifecycle'
import { runCountdown } from './countdown'
import { loadGuard } from './guard-store'
import { releaseNotesToText } from './update-yml'

const COUNTDOWN_SECONDS = 60

export class UpdaterService {
  private state: UpdaterState
  private timer: NodeJS.Timeout | null = null
  private skip = false
  private installing = false

  constructor(
    private readonly getSettings: () => Settings,
    private readonly emit: (s: UpdaterState) => void,
    rolledBackFrom?: string,
  ) {
    this.state = { phase: 'idle', currentVersion: app.getVersion(), rolledBackFrom }
    autoUpdater.logger = null
    autoUpdater.allowDowngrade = false
    this.wire()
    this.applySettings()
  }

  getState(): UpdaterState {
    return this.state
  }

  private set(patch: Partial<UpdaterState>) {
    this.state = { ...this.state, ...patch }
    this.emit(this.state)
  }

  /** Muss bei jeder Änderung der Einstellungen aufgerufen werden. */
  applySettings() {
    const { updates } = this.getSettings()
    const beta = updates.channel === 'beta'
    autoUpdater.channel = beta ? 'beta' : 'latest'
    autoUpdater.allowPrerelease = beta
    // Wer von Beta auf Stable wechselt, darf auf die stabile Version "herabgestuft" werden.
    autoUpdater.allowDowngrade = !beta && app.getVersion().includes('-')
    autoUpdater.autoDownload = updates.autoInstall
    autoUpdater.autoInstallOnAppQuit = updates.autoInstall
    this.schedule(updates.checkIntervalHours)
  }

  private schedule(hours: number) {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.check(), hours * 3_600_000)
  }

  private wire() {
    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking', error: undefined }))
    autoUpdater.on('update-not-available', () => this.set({ phase: 'uptodate', lastChecked: Date.now() }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (isBadVersion(loadGuard(), info.version)) {
        this.set({ phase: 'uptodate', lastChecked: Date.now() })
        return
      }
      this.set({
        phase: this.getSettings().updates.autoInstall ? 'downloading' : 'available',
        version: info.version,
        notes: releaseNotesToText(info.releaseNotes),
        percent: 0,
        lastChecked: Date.now(),
      })
    })
    autoUpdater.on('download-progress', (p) => this.set({ phase: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ phase: 'ready', version: info.version, percent: 100 })
      if (this.getSettings().notifications.desktop)
        new Notification({ title: 'TRM-Craft', body: `Version ${info.version} ist bereit und wird beim nächsten Start installiert.` }).show()
    })
    autoUpdater.on('error', (e) => this.set({ phase: 'error', error: e?.message ?? String(e) }))
  }

  async check(): Promise<void> {
    if (!app.isPackaged) {
      // Im Entwicklungsmodus gibt es keine Update-Quelle.
      this.set({ phase: 'uptodate', lastChecked: Date.now() })
      return
    }
    if (this.installing || ['downloading', 'ready', 'countdown'].includes(this.state.phase)) return
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  async download(): Promise<void> {
    if (this.state.phase !== 'available') return
    this.set({ phase: 'downloading', percent: 0 })
    await autoUpdater.downloadUpdate()
  }

  skipCountdown() {
    this.skip = true
  }

  /** Stoppt laufende Server (mit Ankündigung im Chat) und installiert dann sofort. */
  async installNow(): Promise<void> {
    if (this.state.phase !== 'ready' || this.installing) return
    this.installing = true
    this.skip = false
    if (activeServerCount() > 0) {
      await runCountdown({
        seconds: COUNTDOWN_SECONDS,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        shouldSkip: () => this.skip,
        onTick: (left) => {
          this.set({ phase: 'countdown', secondsLeft: left })
          if (left === COUNTDOWN_SECONDS || left === 30 || left === 10) void announceAll(left)
        },
      })
    }
    this.set({ phase: 'installing', secondsLeft: undefined })
    await stopAll()
    // Server laufen nach dem Update wieder an (Autostart-Flag im Server-Manager, ab Meilenstein 3).
    autoUpdater.quitAndInstall(true, true)
  }
}
