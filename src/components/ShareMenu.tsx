import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Asset } from '../lib/asset'
import { useLiveLinks, type LiveLink } from '../lib/liveLinks'
import { LIVE_LINK_HOURS, liveLinkShare, locationShare } from '../lib/share'
import { shareOrCopy } from '../lib/shareSheet'
import { useNow } from '../lib/useNow'
import { createLink } from '../server/sharing.functions'

type Props = { asset: Asset; address: string | undefined }

/** How long a notice under the button stays. */
const NOTICE_MS = 3_000

/**
 * The Share button and its menu: send where the asset is once, or share it live for 1, 8 or 24
 * hours (see sharing.server.ts). A drop-down on wider screens, an action sheet from the bottom on
 * phones. While a live link made in this browser is active, Sharing live beside it leads to
 * Settings → Live links, where links are stopped.
 */
export function ShareMenu({ asset, address }: Props) {
  const [open, setOpen] = useState(false)
  // Where the drop-down goes on wider screens: under the button, placed from its position so the
  // scrolling asset list can't clip it. Phones get an action sheet from CSS instead.
  const [anchor, setAnchor] = useState<{ top: number; left: number }>()
  const [busy, setBusy] = useState(false)
  // A link Safari wouldn't share straight after it was made: the button sends it on the next tap.
  const [unsent, setUnsent] = useState<LiveLink>()
  // Last resort when neither the share sheet nor the clipboard works (e.g. a page without HTTPS):
  // the link itself, to select and copy by hand.
  const [manual, setManual] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const now = useNow(30_000)
  const [allLinks, addLink] = useLiveLinks(now)
  const live = allLinks.some((link) => link.assetId === asset.id)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  // Keyboard: focus the first item on open, arrows move, Escape closes, focus goes back to the button.
  useEffect(() => {
    if (!open) return
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    items()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const all = items()
      const index = all.indexOf(document.activeElement as HTMLElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      all[(index + step + all.length) % all.length]?.focus()
    }
    const onResize = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  function toggle() {
    if (open) return close()
    setManual(undefined)
    const rect = buttonRef.current?.getBoundingClientRect()
    const dropDown = rect && window.matchMedia('(min-width: 768px)').matches
    setAnchor(dropDown ? { top: rect.bottom + 6, left: rect.left } : undefined)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  async function run(action: () => Promise<void>) {
    close()
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const sendLocation = () =>
    run(async () => {
      if (!asset.location) return
      const result = await shareOrCopy(locationShare(asset.name, asset.location, address, Date.now()))
      if (result === 'copied') setNotice('Location copied')
      if (result === 'failed') setNotice("Couldn't share the location")
    })

  async function sendLink(link: LiveLink) {
    const url = `${window.location.origin}/s/${link.link}`
    const result = await shareOrCopy(liveLinkShare(asset.name, url, link.expiresAt, Date.now()))
    if (result === 'failed' && unsent?.link === link.link) {
      // The second try failed too: sharing isn't possible here at all.
      setUnsent(undefined)
      setManual(url)
      return
    }
    setUnsent(result === 'failed' ? link : undefined)
    if (result === 'copied') setNotice('Link copied')
  }

  const shareLive = (hours: number) =>
    run(async () => {
      try {
        const { link, expiresAt } = await createLink({ data: { assetId: asset.id, hours } })
        const made = { link, assetId: asset.id, expiresAt, name: asset.name }
        addLink(made)
        await sendLink(made)
      } catch {
        setNotice("Couldn't make a link")
      }
    })

  return (
    <div className="location-actions">
      {unsent ? (
        <button type="button" className="location-button" onClick={() => void sendLink(unsent)}>
          <ShareIcon />
          Send link
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className="location-button"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={toggle}
        >
          <ShareIcon />
          Share
        </button>
      )}
      {live && (
        <Link to="/settings" hash="live-links" className="location-live">
          <span className="location-live-dot" aria-hidden="true" />
          Sharing live
        </Link>
      )}
      <span className="location-notice" role="status">
        {notice}
      </span>
      {manual && (
        <input
          className="location-link-field"
          readOnly
          value={manual}
          aria-label="Live link: select and copy it"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      {/* Drawn at the end of the page, outside the asset list, so the list's clipping and layering
          can't affect it. Clicks inside stay here rather than reaching the list, which would take
          them as a deselect. */}
      {open &&
        createPortal(
          <div className="location-layer" onClick={(event) => event.stopPropagation()}>
            <div className="location-backdrop" onClick={close} />
            <div ref={menuRef} className="location-menu" role="menu" aria-label={`Share ${asset.name}`} style={anchor}>
              {asset.location && (
                <MenuItem onSelect={sendLocation}>Send location</MenuItem>
              )}
              <div className="location-menu-group" role="group" aria-labelledby="live-link-heading">
                <span id="live-link-heading" className="location-menu-heading">
                  Share live location
                </span>
                {LIVE_LINK_HOURS.map((hours) => (
                  <MenuItem key={hours} onSelect={() => shareLive(hours)}>
                    For {hours === 1 ? '1 hour' : `${hours} hours`}
                  </MenuItem>
                ))}
              </div>
              <MenuItem cancel onSelect={close}>
                Cancel
              </MenuItem>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

type ItemProps = { children: ReactNode; onSelect: () => void; cancel?: boolean }

function MenuItem({ children, onSelect, cancel }: ItemProps) {
  const className = `location-menu-item${cancel ? ' location-menu-cancel' : ''}`
  return (
    <button type="button" role="menuitem" className={className} onClick={() => void onSelect()}>
      {children}
    </button>
  )
}

/** A box with an arrow out of it, the usual share symbol. Decorative; the label says it. */
function ShareIcon() {
  return (
    <svg className="location-button-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10V1.75M5 4.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 6.75H4.25a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
