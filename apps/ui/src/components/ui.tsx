import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return (
    <button
      {...p}
      className={clsx(
        'no-drag inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-ctl px-4 text-[13px] font-medium',
        'transition-[transform,background-color,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
        variant === 'ghost' && 'hairline bg-raised/60 text-fg hover:bg-raised',
        className,
      )}
    />
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx('no-drag relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out', checked ? 'bg-accent' : 'bg-raised hairline')}
    >
      <motion.span
        className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
      />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="no-drag hairline inline-flex rounded-ctl bg-raised/60 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('relative h-8 rounded-[8px] px-3 text-[13px] transition-colors duration-150', value === o.value ? 'text-fg' : 'text-muted hover:text-fg')}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[8px] bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] hairline" transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
      <div className="divide-y divide-line/[0.08]">{children}</div>
    </section>
  )
}
