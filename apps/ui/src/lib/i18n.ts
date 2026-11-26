import { useStore } from './store'

const de = {
  'nav.dashboard': 'Dashboard',
  'nav.settings': 'Einstellungen',
  'win.minimize': 'Minimieren',
  'win.maximize': 'Maximieren',
  'win.close': 'Schließen',
  'dash.title': 'Deine Server',
  'dash.empty.title': 'Noch kein Server',
  'dash.empty.body': 'Sobald der Server-Assistent verfügbar ist, erscheinen deine Server hier als Karten mit Status, Spielern und Auslastung.',
  'dash.stat.servers': 'Server',
  'dash.stat.online': 'Online',
  'dash.stat.players': 'Spieler',
  'settings.title': 'Einstellungen',
  'settings.appearance': 'Darstellung',
  'settings.language': 'Sprache',
  'settings.theme': 'Design',
  'settings.theme.dark': 'Dunkel',
  'settings.theme.light': 'Hell',
  'settings.theme.system': 'System',
  'settings.accent': 'Akzentfarbe',
  'settings.behavior': 'Verhalten',
  'settings.background': 'Im Hintergrund weiterlaufen',
  'settings.background.hint': 'Server laufen weiter, wenn du das Fenster schließt.',
  'settings.notifications': 'Windows-Benachrichtigungen',
  'settings.about': 'Über TRM-Craft',
  'settings.version': 'Version',
  'settings.dataDir': 'Datenordner',
  'onb.title': 'Willkommen bei TRM-Craft',
  'onb.body': 'Hoste Minecraft-Server auf deinem eigenen PC. Wähle kurz Sprache und Look, den Rest erledigst du später in den Einstellungen.',
  'onb.start': 'Los geht\'s',
  'accent.emerald': 'Smaragd',
  'accent.amber': 'Bernstein',
  'accent.violet': 'Violett',
  'accent.sky': 'Himmel',
  'accent.rose': 'Rose',
} as const

type Key = keyof typeof de
const en: Record<Key, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.settings': 'Settings',
  'win.minimize': 'Minimize',
  'win.maximize': 'Maximize',
  'win.close': 'Close',
  'dash.title': 'Your servers',
  'dash.empty.title': 'No servers yet',
  'dash.empty.body': 'Once the server wizard is available, your servers will show up here as cards with status, players and load.',
  'dash.stat.servers': 'Servers',
  'dash.stat.online': 'Online',
  'dash.stat.players': 'Players',
  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.theme.system': 'System',
  'settings.accent': 'Accent color',
  'settings.behavior': 'Behavior',
  'settings.background': 'Keep running in background',
  'settings.background.hint': 'Servers keep running when you close the window.',
  'settings.notifications': 'Windows notifications',
  'settings.about': 'About TRM-Craft',
  'settings.version': 'Version',
  'settings.dataDir': 'Data folder',
  'onb.title': 'Welcome to TRM-Craft',
  'onb.body': 'Host Minecraft servers on your own PC. Pick a language and look now, everything else can wait for the settings.',
  'onb.start': 'Get started',
  'accent.emerald': 'Emerald',
  'accent.amber': 'Amber',
  'accent.violet': 'Violet',
  'accent.sky': 'Sky',
  'accent.rose': 'Rose',
}

export const dictionaries = { de, en } as const
export type { Key }

export function translate(lang: 'de' | 'en', key: Key): string {
  return dictionaries[lang][key]
}

export function useT() {
  const lang = useStore((s) => s.settings.language)
  return (key: Key) => translate(lang, key)
}
