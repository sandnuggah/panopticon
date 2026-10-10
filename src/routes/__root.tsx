import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { App } from 'konsta/react'
import { platformFor } from '../lib/platform'
import { requestPlatform } from '../server/platform.server'
import '../styles.css'

const currentPlatform = createIsomorphicFn()
  .server(() => requestPlatform())
  .client(() => platformFor(navigator.userAgent))

export const Route = createRootRoute({
  beforeLoad: () => ({ platform: currentPlatform() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      // Android Chrome: follow the phone's text size, as iOS does through Dynamic Type (styles.css).
      { name: 'text-scale', content: 'scale' },
      { name: 'color-scheme', content: 'light dark' },
      { name: 'theme-color', content: '#2f8f5b' },
      { name: 'apple-mobile-web-app-title', content: 'Panopticon' },
      // As a home-screen app, the status bar lies over the page instead of above it, so the map
      // reaches the top of the screen. Pages keep their content below it with safe-area padding.
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { title: 'Panopticon' },
    ],
    links: [
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
    // Blocking, before the first paint: sets Konsta's .dark class from the device's setting.
    scripts: [{ src: '/color-scheme.js' }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const { platform } = Route.useRouteContext()
  return (
    // color-scheme.js sets the class before React hydrates, so the server's html never has it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <App theme={platform} safeAreas dark>
          {children}
        </App>
        <Scripts />
      </body>
    </html>
  )
}
