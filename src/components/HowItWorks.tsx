/**
 * The front page's "How the tracking works": the three steps from a tracker to the map, as numbered
 * paper-cutout badges like the feature trail's, and how many trackers Traccar works with. The counts
 * are Traccar's own (traccar.org/devices: about 2,150 models over 266 protocols in October 2026),
 * rounded down so they stay true.
 */

const DEVICES = 'https://www.traccar.org/devices/'

const STEPS = [
  {
    title: 'A GPS tracker',
    text: 'On the collar, in the bag or under the saddle. It works out where it is from GPS satellites and sends it over the mobile network, every few seconds while it moves.',
    color: 'bg-[#cc0605]',
  },
  {
    title: 'Your Traccar server',
    text: 'Traccar, free and open source, receives the reports and keeps them, on a server of your own.',
    color: 'bg-[#2271b3]',
  },
  {
    title: 'Panopticon',
    text: 'Puts them on a live map on your phone, with trails, places, alerts and links to share.',
    color: 'bg-primary',
  },
]

const COUNTS = [
  { number: '2,000+', label: 'tracker models' },
  { number: '200+', label: 'protocols' },
]

export function HowItWorks() {
  return (
    <div className="px-6 lg:px-0">
      <ol className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4 lg:flex-1 lg:flex-col lg:items-center lg:text-center">
            <span
              className={`feature-stop grid size-11 shrink-0 place-items-center rounded-full text-lg font-bold text-white ${step.color} ${index % 2 ? 'rotate-6' : '-rotate-6'}`}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div>
              <h3 className="text-[1.0625rem] font-semibold">{step.title}</h3>
              <p className="pt-1 text-[0.9375rem] opacity-75">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex justify-center gap-10 lg:mt-14 lg:gap-20">
        {COUNTS.map((count) => (
          <p key={count.label} className="text-center">
            <span className="paper-title block text-[calc(1rem+20px)] leading-tight lg:text-5xl">{count.number}</span>
            <span className="text-[0.9375rem] opacity-75">{count.label}</span>
          </p>
        ))}
      </div>
      <p className="mx-auto max-w-xl pt-6 text-center text-[0.9375rem] opacity-75">
        Traccar works with trackers from most makers, such as Teltonika, Concox, Queclink, Suntech and SinoTrack, and with a phone running
        the Traccar Client app.{' '}
        <a href={DEVICES} className="font-medium text-primary active:opacity-50" target="_blank" rel="noopener">
          Find yours in Traccar's device list
        </a>
        .
      </p>
    </div>
  )
}
