import { createFileRoute } from '@tanstack/react-router'
import { Block, Button, Page } from 'konsta/react'
import { FeatureTrail, type Feature } from '../components/FeatureTrail'
import { HowItWorks } from '../components/HowItWorks'
import { ScreenshotGallery } from '../components/ScreenshotGallery'
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

/** The source and the setup guide, for running your own. */
const REPOSITORY = 'https://github.com/sandnuggah/panopticon'

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

/**
 * A section's heading: small and muted on a phone, like iOS's section headers; on a wide screen a
 * centred heading that introduces the section.
 */
function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="px-8 pb-4 pt-8 text-[0.9375rem] font-medium opacity-60 lg:pb-8 lg:pt-20 lg:text-center lg:text-3xl lg:font-bold lg:opacity-100">
      {children}
    </h2>
  )
}

function WelcomePage() {
  const { signedIn } = Route.useLoaderData()
  return (
    <Page>
      {/* A phone's column; on a wide screen the picture and the title side by side, then wider sections. */}
      <div className="mx-auto max-w-md pb-8 pt-[max(24px,calc(env(safe-area-inset-top)+12px))] lg:max-w-6xl lg:px-10 lg:pb-16 lg:pt-16">
        <header className="lg:grid lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14">
          <div className="px-3">
            <WelcomeScene />
          </div>
          <div className="lg:text-left">
            <h1 className="paper-title px-4 pt-5 text-center text-[calc(1rem+26px)] leading-tight lg:px-0 lg:pt-0 lg:text-left lg:text-[64px]">
              Panopticon
            </h1>
            <p className="px-6 pb-2 pt-2.5 text-center opacity-60 lg:px-0 lg:pt-4 lg:text-left lg:text-xl">
              Your dog, your bag, your bike: where they are, right now.
            </p>
            <Block className="lg:mx-0! lg:max-w-sm lg:px-0!">
              {/* A full page load, so the map starts fresh. */}
              <Button large rounded href={signedIn ? '/' : '/login'}>
                {signedIn ? 'Open the map' : 'Sign in'}
              </Button>
              <p className="pt-3 text-center text-[0.9375rem] opacity-80 lg:text-left">
                or{' '}
                <a href={REPOSITORY} className="font-medium text-primary active:opacity-50" target="_blank" rel="noopener">
                  deploy it yourself
                </a>
              </p>
            </Block>
          </div>
        </header>

        <SectionTitle>What it does</SectionTitle>
        <div className="lg:mx-auto lg:max-w-3xl">
          <FeatureTrail features={FEATURES} />
        </div>
        <SectionTitle>How the tracking works</SectionTitle>
        <div className="lg:mx-auto lg:max-w-4xl">
          <HowItWorks />
        </div>
        <SectionTitle>What it looks like</SectionTitle>
        <ScreenshotGallery />
        <p className="px-8 pt-10 text-center text-sm opacity-60 lg:pt-16">
          Panopticon works in any browser, and on iPhone and Android as an app on your Home Screen.
        </p>
      </div>
    </Page>
  )
}
