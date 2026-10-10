import { createFileRoute } from '@tanstack/react-router'
import { Block, BlockTitle, Button, Page } from 'konsta/react'
import { FeatureTrail, type Feature } from '../components/FeatureTrail'
import { WelcomeScene } from '../components/WelcomeScene'
import { BellIcon, LiveIcon, LocationIcon, LockIcon, PawIcon, PinIcon } from '../components/icons'
import { getUser } from '../server/auth.functions'

// The front page: what Panopticon is and does, with the way in. Where the map (/) sends visitors who
// aren't signed in; signed in, its button opens the map instead of the sign-in page.

export const Route = createFileRoute('/welcome')({
  loader: async () => ({ signedIn: (await getUser()) !== null }),
  head: () => ({
    meta: [
      { title: 'Panopticon' },
      { name: 'description', content: 'A live map of your dog, your bag and your bike, on your own Traccar server.' },
    ],
  }),
  component: WelcomePage,
})

const FEATURES: Feature[] = [
  {
    title: 'A live map',
    text: 'Everything you track on one map, moving the moment its tracker reports, with its battery and when it was last seen.',
    color: 'bg-[#2271b3]',
    icon: <LocationIcon filled />,
  },
  {
    title: 'Where they’ve been',
    text: 'A trail of the last hours or the whole day: walks, rides and the places they stayed. Walks as paw prints, if you like.',
    color: 'bg-[#7e4b26]',
    icon: <PawIcon />,
  },
  {
    title: 'Places',
    text: 'Mark Home, Daycare or the office, and see when each one arrived and left.',
    color: 'bg-[#ff9500]',
    icon: <PinIcon />,
  },
  {
    title: 'Alerts',
    text: 'A notification on your phone when the dog leaves home or a tracker goes quiet, also while the app is closed.',
    color: 'bg-[#cc0605]',
    icon: <BellIcon />,
  },
  {
    title: 'Share live location',
    text: 'Send anyone a link to follow one of them live for a few hours, no account needed. It stops by itself.',
    color: 'bg-[#34c759]',
    icon: <LiveIcon />,
  },
  {
    title: 'Yours alone',
    text: 'Runs next to your own Traccar server. No tracking, no ads, no analytics, and your locations never leave it.',
    color: 'bg-[#8e8e93]',
    icon: <LockIcon />,
  },
]

function WelcomePage() {
  const { signedIn } = Route.useLoaderData()
  return (
    <Page>
      <div className="mx-auto max-w-md pb-8 pt-[max(24px,calc(env(safe-area-inset-top)+12px))]">
        <div className="px-3">
          <WelcomeScene />
        </div>
        <h1 className="paper-title px-4 pt-5 text-center text-[calc(1rem+26px)] leading-tight">Panopticon</h1>
        <p className="px-6 pb-2 pt-2.5 text-center opacity-60">Your dog, your bag, your bike: where they are, right now.</p>
        <Block>
          {/* A full page load, so the map starts fresh. */}
          <Button large rounded href={signedIn ? '/' : '/login'}>
            {signedIn ? 'Open the map' : 'Sign in'}
          </Button>
        </Block>

        <BlockTitle className="mt-6! mb-4! px-8! text-[0.9375rem]! font-medium! opacity-60">What it does</BlockTitle>
        <FeatureTrail features={FEATURES} />
        <p className="px-8 pt-6 text-center text-sm opacity-60">
          Panopticon works in any browser, and on iPhone and Android as an app on your Home Screen. It needs a Traccar server, which does
          the tracking.
        </p>
      </div>
    </Page>
  )
}
