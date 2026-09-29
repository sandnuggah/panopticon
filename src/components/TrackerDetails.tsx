import { useEffect, useRef, useState, type ReactNode } from 'react'
import { statusLabel, type Asset } from '../lib/asset'
import { formatTime } from '../lib/share'
import { SIGNAL_LABELS, type TrackerDetails as Details } from '../lib/tracker'
import { useNow } from '../lib/useNow'
import { getTrackerDetails } from '../server/assets.functions'
import { RelativeTime } from './RelativeTime'

/** How often the open panel refreshes. */
const REFRESH_MS = 30_000

type ButtonProps = { asset: Asset; className: string; children: ReactNode }

/** A button that opens the asset's tracker details. */
export function TrackerDetailsButton({ asset, className, children }: ButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <TrackerDialog asset={asset} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The tracker itself: connection, GPS, signal, network, battery, how often it reports, where its
 * last fix was, and its model (see lib/tracker.ts). A modal <dialog>: a bottom sheet on phones,
 * centred on wider screens. Escape, the close button and a tap outside close it.
 */
function TrackerDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [details, setDetails] = useState<Details>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const closed = () => onCloseRef.current()
    dialog.showModal()
    dialog.addEventListener('close', closed)
    return () => dialog.removeEventListener('close', closed)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getTrackerDetails({ data: asset.id })
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
  }, [asset.id])

  return (
    <dialog
      ref={dialogRef}
      className="tracker-dialog"
      aria-labelledby="tracker-title"
      // A click on the dialog element itself, not its contents, is a click on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
    >
      <div className="tracker-header">
        <h2 id="tracker-title">{asset.name}’s tracker</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {details ? (
        <Rows details={details} />
      ) : failed ? (
        <p className="error" role="alert">
          Couldn't load the tracker's details.
        </p>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </dialog>
  )
}

function Rows({ details }: { details: Details }) {
  const now = useNow(30_000)
  const { gps, signal, network, battery, position } = details
  return (
    <dl className="tracker-rows">
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
      {details.reportEverySeconds !== undefined && (
        <Row label="Reports">About every {interval(details.reportEverySeconds)}</Row>
      )}
      {position && (
        <Row label="Last fix">
          <CopyText text={`${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`} />
        </Row>
      )}
      {(details.model || details.protocol) && (
        <Row label="Model">{[details.model, details.protocol && `(${details.protocol})`].filter(Boolean).join(' ')}</Row>
      )}
    </dl>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
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
      <span className="tracker-copy-text">{text}</span>
      <button
        type="button"
        className="button-quiet tracker-copy"
        onClick={() => {
          navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  )
}

/** Four rising bars, the filled ones in the text colour. Decorative; the word beside it says it. */
function SignalBars({ bars }: { bars: number }) {
  return (
    <svg className="signal-bars" viewBox="0 0 16 12" aria-hidden="true">
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
