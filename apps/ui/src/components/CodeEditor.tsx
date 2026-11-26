import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage, bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { useEffect, useRef } from 'react'

function languageFor(name: string): Extension {
  const n = name.toLowerCase()
  if (n.endsWith('.json') || n.endsWith('.mcmeta')) return json()
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return yaml()
  if (n.endsWith('.js') || n.endsWith('.ts')) return javascript()
  if (n.endsWith('.md')) return markdown()
  if (n.endsWith('.toml')) return StreamLanguage.define(toml)
  if (n.endsWith('.properties') || n.endsWith('.conf') || n.endsWith('.cfg') || n.endsWith('.txt')) return StreamLanguage.define(properties)
  return []
}

/** Code-Editor mit Syntax-Hervorhebung (CodeMirror 6). Wird lazy geladen. */
export default function CodeEditor({ name, value, dark, onChange, onSave }: { name: string; value: string; dark: boolean; onChange: (v: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onChange, onSave })
  cb.current = { onChange, onSave }

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), bracketMatching(), highlightActiveLine(), highlightSelectionMatches(), languageFor(name),
          dark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
          keymap.of([{ key: 'Mod-s', run: () => (cb.current.onSave(), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()) }),
          EditorView.theme({ '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'transparent' }, '.cm-gutters': { backgroundColor: 'transparent', border: 'none' }, '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 0.04)' }, '.cm-scroller': { fontFamily: 'var(--font-mono, "Cascadia Mono", Consolas, monospace)', userSelect: 'text' }, '.cm-content': { userSelect: 'text' } }),
        ],
      }),
    })
    return () => view.destroy()
    // Der Editor wird pro Datei neu aufgebaut (key im Aufrufer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, dark])

  return <div ref={host} className="hairline h-full min-h-[320px] overflow-hidden rounded-card bg-black/30" />
}
