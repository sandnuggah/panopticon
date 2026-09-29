import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useSettings } from '../lib/settings'
import { THEMES, useTheme } from '../lib/theme'
import { TRAIL_OPTIONS, type TrailLength } from '../lib/trail'
import { getUser, logout } from '../server/auth.functions'
import { getMapOptions } from '../server/map.functions'

export const Route = createFileRoute('/settings')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: () => getMapOptions(),
  head: () => ({ meta: [{ title: 'Settings · Panopticon' }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext()
  const mapOptions = Route.useLoaderData()
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
            <output htmlFor="trail-minutes">{trailLabel(settings.trail)}</output>
          </label>
          {/* Steps through the options by position: they aren't evenly spaced in minutes. */}
          <input
            id="trail-minutes"
            className="trail-slider"
            type="range"
            min={0}
            max={TRAIL_OPTIONS.length - 1}
            step={1}
            value={Math.max(0, TRAIL_OPTIONS.indexOf(settings.trail))}
            aria-valuetext={trailLabel(settings.trail)}
            onChange={(event) => updateSettings({ trail: TRAIL_OPTIONS[Number(event.target.value)] })}
          />
          <div className="trail-stops" aria-hidden="true">
            {TRAIL_OPTIONS.map((length) => (
              <span key={length} className={length === settings.trail ? 'trail-stop-current' : undefined}>
                {length === 'today' ? <span className="trail-stop-today">Today</span> : trailStopLabel(length)}
              </span>
            ))}
          </div>
        </div>
        <p className="muted hint">
          How much recent movement to draw behind each asset. Saved in this browser only.
        </p>
        {/* Only when the server has map matching (MAP_MATCHING_URL). */}
        {mapOptions.followRoads && (
          <>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.followRoads}
                onChange={(event) => updateSettings({ followRoads: event.target.checked })}
              />
              Follow roads
            </label>
            <p className="muted hint">
              Draws walks along the streets and paths they most likely took, instead of straight lines between
              GPS fixes. Rides and places the asset stayed are unchanged. Saved in this browser only.
            </p>
          </>
        )}
      </section>

      <section>
        <h2>Assets</h2>
        <Link to="/assets" className="button-quiet">
          Manage assets
        </Link>
        <p className="muted hint">Add or remove trackers, rename them, and change their photos. Saved in Traccar.</p>
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

function trailLabel(length: TrailLength): string {
  if (length === 'today') return 'Today, since midnight'
  const minutes = length
  if (minutes === 0) return 'Off'
  if (minutes < 60) return `Last ${minutes} minutes`
  const hours = minutes / 60
  return hours === 1 ? 'Last hour' : `Last ${hours} hours`
}

/** The short form under each slider stop. */
function trailStopLabel(length: number): string {
  if (length === 0) return 'Off'
  return length < 60 ? `${length}m` : `${length / 60}h`
}
