/**
 * Says a new release of panopticon is running on the server, at the top right of the map: tapping it
 * reloads the page. The Home Screen app otherwise keeps running the version it opened with, and an
 * old page can't call a newer server's functions.
 */
export function UpdateNotice() {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.9375em] font-medium shadow-lg active:opacity-60 ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2"
      onClick={() => window.location.reload()}
    >
      Update available
      <span className="text-primary">Reload</span>
    </button>
  )
}
