export interface CountdownOptions {
  seconds: number
  onTick: (secondsLeft: number) => void
  sleep: (ms: number) => Promise<void>
  /** Gibt true zurück, wenn der Countdown abgebrochen/übersprungen werden soll. */
  shouldSkip: () => boolean
}

/** Zählt von `seconds` herunter. Gibt `true` zurück, wenn vollständig abgelaufen oder übersprungen. */
export async function runCountdown({ seconds, onTick, sleep, shouldSkip }: CountdownOptions): Promise<void> {
  for (let left = seconds; left > 0; left--) {
    if (shouldSkip()) return
    onTick(left)
    await sleep(1000)
  }
}
