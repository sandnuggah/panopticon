/**
 * The battery as a gauge with 0–4 bars, drawn in orange at 20% or below. The exact percentage is
 * its label, for screen readers and as the hover tooltip.
 */
export function BatteryGauge({ percent }: { percent: number }) {
  const bars = batteryBars(percent)
  const label = `Battery ${Math.round(percent)}%`
  return (
    // Drawn on a pixel grid at the size it's shown (16.5 × 9 CSS px), so the 1px outline and the
    // bars land on whole pixels instead of blurring between them.
    <svg
      className={`h-[9px] w-[16.5px] shrink-0 ${percent <= 20 ? 'text-orange-500' : 'opacity-60'}`}
      viewBox="0 0 16.5 9"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <rect x="0.5" y="0.5" width="14" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="15" y="3" width="1.5" height="3" rx="0.5" fill="currentColor" />
      {Array.from({ length: bars }, (_, bar) => (
        <rect key={bar} x={2 + bar * 3} y="2" width="2" height="5" fill="currentColor" />
      ))}
    </svg>
  )
}

/** Empty below 5%, then one bar per started quarter: 5–25% is one bar, 76–100% is four. */
function batteryBars(percent: number): number {
  if (percent < 5) return 0
  return Math.min(4, Math.ceil(percent / 25))
}
