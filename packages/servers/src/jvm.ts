import type { ServerRecord } from '@trm/core'

/** Aikar's Flags: https://docs.papermc.io/paper/aikars-flags */
export function aikarFlags(ramMb: number): string[] {
  const big = ramMb >= 12 * 1024
  return [
    '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${big ? 40 : 30}`, `-XX:G1MaxNewSizePercent=${big ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${big ? '16M' : '8M'}`, `-XX:G1ReservePercent=${big ? 15 : 20}`,
    '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
    `-XX:InitiatingHeapOccupancyPercent=${big ? 20 : 15}`, '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true',
  ]
}

export function jvmArgs(r: Pick<ServerRecord, 'ramMb' | 'jvmPreset' | 'launch'> & { limits?: ServerRecord['limits'] }, platform: NodeJS.Platform = process.platform): string[] {
  // -XX:ActiveProcessorCount begrenzt, wie viele Kerne die JVM nutzt (CPU-Limit).
  const mem = [`-Xms${r.ramMb}M`, `-Xmx${r.ramMb}M`, ...(r.limits?.cores ? [`-XX:ActiveProcessorCount=${r.limits.cores}`] : []), ...(r.jvmPreset === 'aikar' ? aikarFlags(r.ramMb) : [])]
  if (r.launch.type === 'args') return [...mem, `@${r.launch.argsFile.replace('{platform}', platform === 'win32' ? 'win' : 'unix')}`, 'nogui']
  if (r.launch.type === 'exe') throw new Error('Natives Programm hat keine JVM-Argumente.')
  return [...mem, '-jar', r.launch.jar, 'nogui']
}
