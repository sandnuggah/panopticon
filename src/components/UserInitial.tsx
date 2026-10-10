/** The signed-in user's initial in an accent-coloured circle; Traccar users have no picture. */
export function UserInitial({ name, className }: { name: string; className: string }) {
  return (
    <span className={`fixed-size grid place-items-center rounded-full bg-primary font-semibold text-white ${className}`} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
