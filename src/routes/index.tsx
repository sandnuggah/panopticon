import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { RelativeTime } from '../components/RelativeTime'
import type { Pet } from '../lib/pet'
import { getUser, logout } from '../server/auth.functions'
import { getPets } from '../server/pets.functions'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: () => getPets(),
  component: Home,
})

// Step 1: a plain list to prove sign-in and data loading. The map and bottom sheet come in step 2.
function Home() {
  const pets = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()

  async function onLogout() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  return (
    <main className="home">
      <header>
        <h1>tracpet</h1>
        <span className="muted">{user.name}</span>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </header>
      {pets.length === 0 ? (
        <p className="muted">No trackers on this account yet.</p>
      ) : (
        <ul className="pets">
          {pets.map((pet) => (
            <PetRow key={pet.id} pet={pet} />
          ))}
        </ul>
      )}
    </main>
  )
}

function PetRow({ pet }: { pet: Pet }) {
  return (
    <li>
      <strong>{pet.name}</strong>
      <span className={`status status-${pet.status}`}>{pet.status}</span>
      <span>
        {pet.location ? (
          <>
            Seen <RelativeTime time={pet.location.fixTime} />
          </>
        ) : (
          'No location yet'
        )}
      </span>
      {pet.lastUpdate && (
        <span className="muted">
          Last contact <RelativeTime time={pet.lastUpdate} />
        </span>
      )}
      {pet.location && (
        <span className="muted">
          {pet.location.lat.toFixed(5)}, {pet.location.lon.toFixed(5)}
          {pet.location.accuracy !== undefined && ` ±${Math.round(pet.location.accuracy)} m`}
        </span>
      )}
      {pet.battery?.percent !== undefined && <span>Battery {pet.battery.percent}%</span>}
      {pet.battery?.percent === undefined && pet.battery?.volts !== undefined && (
        <span>Battery {pet.battery.volts} V</span>
      )}
    </li>
  )
}
