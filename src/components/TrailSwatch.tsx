/**
 * A trail colour as a dot: its day shade, and its night one in the lower half. Fills, not styles,
 * so the server can render it under the CSP (see ARCHITECTURE.md).
 */
export function TrailSwatch({ day, night }: { day: string; night: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill={day} />
      <path d="M1 11 A10 10 0 0 0 21 11 Z" fill={night} />
    </svg>
  )
}
