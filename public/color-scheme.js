// Konsta UI's dark mode is a .dark class on <html>. This keeps it in step with the device's light
// or dark setting. Loaded as a blocking script in <head>, so the first paint is already right.
;(() => {
  const query = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => document.documentElement.classList.toggle('dark', query.matches)
  apply()
  query.addEventListener('change', apply)
})()
