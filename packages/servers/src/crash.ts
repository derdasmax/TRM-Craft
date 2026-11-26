import type { CrashReport } from '@trm/core'

const RULES: { test: RegExp; report: (m: RegExpExecArray) => CrashReport }[] = [
  {
    test: /Address already in use|FAILED TO BIND TO PORT|Failed to bind to port/i,
    report: () => ({ kind: 'port-in-use', message: 'Der Port ist bereits belegt.', hint: 'Ein anderer Server oder ein anderes Programm nutzt diesen Port. Ändere den Port in den Server-Einstellungen.' }),
  },
  {
    test: /UnsupportedClassVersionError.*?(?:class file version (\d+)|has been compiled by)/i,
    report: () => ({ kind: 'java-too-old', message: 'Die Java-Version passt nicht zu dieser Server-Version.', hint: 'Erstelle den Server mit der gewünschten Minecraft-Version neu, dann wird die passende Java-Version geladen.' }),
  },
  {
    test: /java\.lang\.OutOfMemoryError|Could not reserve enough space|There is insufficient memory/i,
    report: () => ({ kind: 'out-of-memory', message: 'Dem Server ist der Arbeitsspeicher ausgegangen.', hint: 'Erhöhe den RAM in den Server-Einstellungen. Lass genug Speicher für Windows frei.' }),
  },
  {
    test: /You need to agree to the EULA/i,
    report: () => ({ kind: 'eula', message: 'Die Minecraft-EULA wurde nicht akzeptiert.', hint: 'Erstelle den Server neu und akzeptiere die EULA im Assistenten.' }),
  },
  {
    test: /Invalid or corrupt jarfile|Unable to access jarfile|Error: Invalid or corrupt/i,
    report: () => ({ kind: 'corrupt-jar', message: 'Die Server-Datei ist beschädigt.', hint: 'Erstelle den Server neu, damit die Server-Software erneut geladen wird.' }),
  },
  {
    test: /Incompatible mod set|Mod ([\w .\-]+) requires (?:version )?([^\s]+) of ([\w .\-]+)/i,
    report: (m) => ({ kind: 'mod-incompatible', message: m[1] ? `Mod ${m[1]} ist mit dieser Version nicht kompatibel.` : 'Ein Mod ist mit dieser Version nicht kompatibel.', hint: 'Entferne oder aktualisiere den genannten Mod.' }),
  },
]

export function analyzeCrash(lines: string[], exitCode: number | null): CrashReport | undefined {
  const text = lines.slice(-400).join('\n')
  for (const r of RULES) {
    const m = r.test.exec(text)
    if (m) return r.report(m)
  }
  if (exitCode !== 0 && exitCode !== null) return { kind: 'unknown', message: `Der Server wurde unerwartet beendet (Code ${exitCode}).`, hint: 'Sieh dir die letzten Zeilen der Konsole an.' }
  return undefined
}
