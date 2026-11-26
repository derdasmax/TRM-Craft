import { lazy, type ComponentType } from 'react'

/** React.lazy für benannte Exporte: `lazyNamed(() => import('./X'), 'X')`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<K extends string, C extends ComponentType<any>>(load: () => Promise<Record<K, C>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })))
}
