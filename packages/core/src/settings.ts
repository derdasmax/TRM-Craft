import { z } from 'zod'

export const AccentSchema = z.enum(['emerald', 'amber', 'violet', 'sky', 'rose'])
export type Accent = z.infer<typeof AccentSchema>

export const SettingsSchema = z.object({
  language: z.enum(['de', 'en']).default('de'),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  accent: AccentSchema.default('emerald'),
  onboardingDone: z.boolean().default(false),
  runInBackground: z.boolean().default(true),
  updates: z
    .object({
      channel: z.enum(['stable', 'beta']).default('stable'),
      autoInstall: z.boolean().default(true),
      checkIntervalHours: z.number().int().min(1).max(168).default(6),
    })
    .default({}),
  notifications: z
    .object({
      desktop: z.boolean().default(true),
    })
    .default({}),
})

export type Settings = z.infer<typeof SettingsSchema>

export const defaultSettings: Settings = SettingsSchema.parse({})

/** Parses untrusted/old settings JSON; unknown or invalid values fall back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const full = SettingsSchema.safeParse(raw)
  if (full.success) return full.data
  // Field-wise recovery so one bad value doesn't reset everything.
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(SettingsSchema.shape) as (keyof Settings)[]) {
    const field = SettingsSchema.shape[key]
    const r = field.safeParse(obj[key])
    out[key] = r.success ? r.data : field.parse(undefined)
  }
  return SettingsSchema.parse(out)
}

/** Deep-merges a partial patch into settings and validates the result. */
export function mergeSettings(current: Settings, patch: DeepPartial<Settings>): Settings {
  const merged = {
    ...current,
    ...patch,
    updates: { ...current.updates, ...(patch.updates ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
  }
  return parseSettings(merged)
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
