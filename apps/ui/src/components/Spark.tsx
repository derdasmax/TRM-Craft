/** Kleiner Verlauf für Dashboard-Karten (eine Reihe, Akzentfarbe, ohne Achsen). */
export function Spark({ label, unit, data }: { label: string; unit: string; data: number[] }) {
  const pts = data.slice(-60)
  const W = 100, H = 28
  const max = Math.max(1, ...pts) * 1.1
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * W
  const y = (v: number) => H - 2 - (v / max) * (H - 4)
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = pts.at(-1) ?? 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11.5px] text-muted"><span>{label}</span><span className="font-mono tabular-nums text-fg">{Math.round(last)}{unit}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${Math.round(last)}${unit}`} className="mt-0.5 h-7 w-full">
        <path d={`${d} L${W},${H} L0,${H} Z`} fill="rgb(var(--accent) / 0.12)" />
        <path d={d} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
