import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useSettings } from '../lib/settings'
import { THEMES, useTheme } from '../lib/theme'
import { TRAIL_MINUTES_OPTIONS } from '../lib/trail'
import { getUser, logout } from '../server/auth.functions'

export const Route = createFileRoute('/settings')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  head: () => ({ meta: [{ title: 'Settings · Panopticon' }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [settings, updateSettings] = useSettings()
  const [theme, setTheme] = useTheme()

  async function onLogout() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  return (
    <main className="page settings">
      <header className="settings-header">
        <Link to="/" className="button-quiet">
          ← Map
        </Link>
        <h1>Settings</h1>
      </header>

      <section>
        <h2>Appearance</h2>
        <fieldset className="theme-picker">
          <legend>Theme</legend>
          {THEMES.map((option) => (
            <label
              key={option.id}
              className={`theme-option${option.id === theme ? ' theme-option-selected' : ''}`}
            >
              <input
                type="radio"
                name="theme"
                value={option.id}
                checked={option.id === theme}
                onChange={() => setTheme(option.id)}
              />
              <span className={`theme-preview theme-preview-${option.id}`} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="theme-text">
                <strong>{option.label}</strong>
                <span className="muted">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="muted hint">Saved in this browser only.</p>
      </section>

      <section>
        <h2>Map</h2>
        <div className="field trail-field">
          <label htmlFor="trail-minutes" className="trail-label">
            Trail
            <output htmlFor="trail-minutes">{trailLabel(settings.trailMinutes)}</output>
          </label>
          {/* Steps through the options by position: they aren't evenly spaced in minutes. */}
          <input
            id="trail-minutes"
            className="trail-slider"
            type="range"
            min={0}
            max={TRAIL_MINUTES_OPTIONS.length - 1}
            step={1}
            value={Math.max(0, (TRAIL_MINUTES_OPTIONS as readonly number[]).indexOf(settings.trailMinutes))}
            aria-valuetext={trailLabel(settings.trailMinutes)}
            onChange={(event) => updateSettings({ trailMinutes: TRAIL_MINUTES_OPTIONS[Number(event.target.value)] })}
          />
          <div className="trail-stops" aria-hidden="true">
            {TRAIL_MINUTES_OPTIONS.map((minutes) => (
              <span key={minutes} className={minutes === settings.trailMinutes ? 'trail-stop-current' : undefined}>
                {trailStopLabel(minutes)}
              </span>
            ))}
          </div>
        </div>
        <p className="muted hint">
          How much recent movement to draw behind each asset. Saved in this browser only.
        </p>
      </section>

      <section>
        <h2>Account</h2>
        <p>
          Signed in as <strong>{user.name}</strong>
        </p>
        <button type="button" className="button-quiet" onClick={onLogout}>
          Sign out
        </button>
      </section>
    </main>
  )
}

function trailLabel(minutes: number): string {
  if (minutes === 0) return 'Off'
  if (minutes < 60) return `Last ${minutes} minutes`
  const hours = minutes / 60
  return hours === 1 ? 'Last hour' : `Last ${hours} hours`
}

/** The short form under each slider stop. */
function trailStopLabel(minutes: number): string {
  if (minutes === 0) return 'Off'
  return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`
}
