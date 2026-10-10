import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { BlockFooter, BlockTitle, Button, List, ListItem } from 'konsta/react'
import type { Asset } from '../lib/asset'
import { useLiveLinks, type LiveLink } from '../lib/liveLinks'
import { LIVE_LINK_HOURS, liveLinkShare, locationShare } from '../lib/share'
import { shareOrCopy } from '../lib/shareSheet'
import { useNow } from '../lib/useNow'
import { createLink } from '../server/sharing.functions'
import { Backdrop, CARD_BG, CloseButton, pageCardClass, ROWS } from './cards'

type Props = {
  asset: Asset
  address: string | undefined
  /** False once the card holding Share has closed, which closes the Share card too. */
  active: boolean
}

/** How long a notice under the buttons stays. */
const NOTICE_MS = 3_000

/**
 * Share, and the Share card it opens, a second-level card like Settings' pages: send where the
 * asset is once, or share it live for 1, 8 or 24 hours (see sharing.server.ts). The card is drawn
 * into the map screen (a portal), so it covers the screen rather than the details card it's in. While a live link made in this browser is active, Sharing live beside it
 * opens Settings → Live links, where links are stopped.
 */
export function Share({ asset, address, active }: Props) {
  const [open, setOpen] = useState(false)
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
  const navigate = useNavigate()
  const shareButton = useRef<HTMLButtonElement>(null)
  const [host, setHost] = useState<Element | null>(null)

  useEffect(() => setHost(document.querySelector('.app')), [])

  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  async function run(action: () => Promise<void>) {
    setOpen(false)
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
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {unsent ? (
          <Button rounded onClick={() => void sendLink(unsent)}>
            <ShareIcon />
            Send link
          </Button>
        ) : (
          <Button
            ref={shareButton}
            rounded
            disabled={busy}
            onClick={() => {
              setManual(undefined)
              setOpen(true)
            }}
          >
            <ShareIcon />
            Share
          </Button>
        )}
        {live && (
          <Button rounded outline onClick={() => void navigate({ to: '/', search: (prev) => ({ ...prev, settings: 'live-links' }) })}>
            <span className="mr-1.5 size-2 rounded-full bg-[var(--online)]" aria-hidden="true" />
            Sharing live
          </Button>
        )}
      </div>
      {notice && (
        <p className="text-sm opacity-60" role="status">
          {notice}
        </p>
      )}
      {manual && (
        <input
          className="w-full rounded-xl bg-black/5 px-3 py-2 text-base dark:bg-white/10"
          readOnly
          value={manual}
          aria-label="Live link: select and copy it"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      {host &&
        createPortal(
          <ShareCard
            asset={asset}
            open={open}
            onSendLocation={() => void sendLocation()}
            onShareLive={(hours) => void shareLive(hours)}
            onClose={() => {
              setOpen(false)
              shareButton.current?.focus({ preventScroll: true })
            }}
          />,
          host,
        )}
    </div>
  )
}

type CardProps = {
  asset: Asset
  open: boolean
  onSendLocation: () => void
  onShareLive: (hours: number) => void
  onClose: () => void
}

/** The Share card: covers the screen like Settings' pages, with a large title and ✕. */
function ShareCard({ asset, open, onSendLocation, onShareLive, onClose }: CardProps) {
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    // preventScroll: see BottomBar.tsx.
    close.current?.focus({ preventScroll: true })
    // In the capture phase, and stopped there, so Escape closes this card and not the details
    // card under it too.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  return (
    <>
      <Backdrop shown={open} z="z-50" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label="Share" inert={!open} className={pageCardClass(open)}>
        <div className={`flex h-full flex-col overflow-clip rounded-t-[2.5rem] shadow-2xl ${CARD_BG}`}>
          <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-5">
            <h2 className="truncate text-[34px] font-bold">Share</h2>
            <CloseButton ref={close} onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {asset.location && (
              <List strong inset colors={ROWS}>
                <ListItem
                  link
                  chevron={false}
                  title="Send location"
                  subtitle={`Where ${asset.name} is now, once`}
                  onClick={onSendLocation}
                />
              </List>
            )}
            <BlockTitle>Share live location</BlockTitle>
            <List strong inset colors={ROWS}>
              {LIVE_LINK_HOURS.map((hours) => (
                <ListItem
                  key={hours}
                  link
                  chevron={false}
                  title={`For ${hours === 1 ? '1 hour' : `${hours} hours`}`}
                  onClick={() => onShareLive(hours)}
                />
              ))}
            </List>
            <BlockFooter>
              A link anyone can open to follow {asset.name} on a map until it ends. Stop it early in Settings → Live links.
            </BlockFooter>
          </div>
        </div>
      </section>
    </>
  )
}

/** A box with an arrow out of it, the usual share symbol. Decorative; the label says it. */
function ShareIcon() {
  return (
    <svg className="mr-1.5 size-4" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10V1.75M5 4.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M5.5 6.75H4.25a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
