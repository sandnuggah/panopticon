/**
 * The front page's screenshots: the app on an iPhone, light or dark to match the visitor's own
 * mode, in a row that scrolls sideways and snaps to each shot. Taken in the iOS Simulator against
 * the mock Traccar (dev/mock-traccar.mjs), so they show made-up assets and places only; the files
 * are in public/screenshots, 600 px wide.
 */
const SHOTS = [
  { file: 'map', caption: 'Sixten’s walk, snapped to the streets' },
  { file: 'details', caption: 'At Home, with arrivals and departures' },
  { file: 'place', caption: 'Placing Home on the map' },
  { file: 'settings', caption: 'Assets, places, alerts and more' },
]

export function ScreenshotGallery() {
  return (
    // On a phone a row that scrolls sideways; on a wide screen all four side by side.
    <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] lg:justify-center lg:gap-8 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
      {SHOTS.map((shot) => (
        <li key={shot.file} className="w-[min(62vw,240px)] shrink-0 snap-center lg:w-auto lg:min-w-0 lg:max-w-[230px] lg:flex-1">
          <figure>
            <picture>
              <source srcSet={`/screenshots/${shot.file}-dark.jpg`} media="(prefers-color-scheme: dark)" />
              <img
                src={`/screenshots/${shot.file}-light.jpg`}
                alt={shot.caption}
                width={600}
                height={1304}
                loading="lazy"
                decoding="async"
                className="screenshot w-full"
              />
            </picture>
            <figcaption className="pt-2 text-center text-sm opacity-60">{shot.caption}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  )
}
