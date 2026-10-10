import { useEffect, useState, type ReactNode } from 'react'
import { BlockTitle, Button, List, ListItem } from 'konsta/react'
import { statusLabel } from '../lib/asset'
import { formatTime } from '../lib/share'
import { SIGNAL_LABELS, type TrackerDetails as Details } from '../lib/tracker'
import { useNow } from '../lib/useNow'
import { getTrackerDetails } from '../server/assets.functions'
import { RelativeTime } from './RelativeTime'

/** How often the open panel refreshes. */
const REFRESH_MS = 30_000

/**
 * The tracker itself, on its asset's page (Settings → Manage assets): connection, GPS, signal,
 * network, battery, how often it reports, where its last fix was, and its model (see
 * lib/tracker.ts). Fetched when the page opens and every 30 s while it's open.
 */
export function TrackerSection({ assetId, listColors }: { assetId: number; listColors?: { strongBgIos: string } }) {
  const [details, setDetails] = useState<Details>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getTrackerDetails({ data: assetId })
        .then((loaded) => {
          if (cancelled) return
          setDetails(loaded)
          setFailed(false)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [assetId])

  return (
    <>
      <BlockTitle>Tracker</BlockTitle>
      {details ? (
        <Rows details={details} />
      ) : (
        <List strong inset colors={listColors}>
          <ListItem title={failed ? "Couldn't load the tracker's details" : 'Loading…'} />
        </List>
      )}
    </>
  )
}

function Rows({ details }: { details: Details }) {
  const now = useNow(30_000)
  const { gps, signal, network, battery, position } = details
  return (
    <List strong inset>
      <Row label="Connection">
        {statusLabel(details.status)}
        {details.lastContact && (
          <>
            {' · last contact '}
            <RelativeTime time={details.lastContact} />
          </>
        )}
      </Row>
      {gps && (
        <Row label="GPS">
          {gps.fix
            ? `Fix${gps.satellites !== undefined ? `, ${gps.satellites} satellites` : ''}`
            : gps.lastFix
              ? `No fix since ${formatTime(Date.parse(gps.lastFix), now)}`
              : 'No fix for over an hour'}
        </Row>
      )}
      {signal && (
        <Row label="Mobile signal">
          <SignalBars bars={signal.bars} />
          {SIGNAL_LABELS[signal.level]}
        </Row>
      )}
      {network && (
        <Row label="Network">
          {network.operator ?? `${network.mcc}-${String(network.mnc).padStart(2, '0')}`}
          {network.country && ` · ${network.country}`}
        </Row>
      )}
      {battery && (
        <Row label="Battery">
          {[
            battery.percent !== undefined && `${Math.round(battery.percent)}%`,
            battery.volts !== undefined && `${battery.volts.toFixed(1)} V`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Row>
      )}
      {details.reportEverySeconds !== undefined && <Row label="Reports">About every {interval(details.reportEverySeconds)}</Row>}
      {position && (
        <Row label="Last fix">
          <CopyText text={`${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`} />
        </Row>
      )}
      {(details.model || details.protocol) && (
        <Row label="Model">{[details.model, details.protocol && `(${details.protocol})`].filter(Boolean).join(' ')}</Row>
      )}
    </List>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <ListItem title={label} after={<span className="flex items-center gap-1.5 text-right">{children}</span>} />
}

function interval(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`
}

/** Text with a Copy button; the text stays selectable where the clipboard isn't available. */
function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <>
      <span className="select-text">{text}</span>
      <Button
        small
        rounded
        tonal
        className="w-auto! px-2.5"
        onClick={() => {
          navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </>
  )
}

/** Four rising bars, the filled ones in the text colour. Decorative; the word beside it says it. */
function SignalBars({ bars }: { bars: number }) {
  return (
    <svg className="h-3 w-4" viewBox="0 0 16 12" aria-hidden="true">
      {[0, 1, 2, 3].map((bar) => (
        <rect
          key={bar}
          x={bar * 4}
          y={9 - bar * 3}
          width="3"
          height={3 + bar * 3}
          rx="0.5"
          fill="currentColor"
          opacity={bar < bars ? 1 : 0.25}
        />
      ))}
    </svg>
  )
}
