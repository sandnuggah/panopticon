import { useState } from 'react'
import { BlockFooter, Button, List, ListItem } from 'konsta/react'
import { useLiveLinks, type LiveLink } from '../lib/liveLinks'
import { formatTime } from '../lib/share'
import { useNow } from '../lib/useNow'
import { stopLink } from '../server/sharing.functions'

/** The live location links made in this browser, each with Stop (see sharing.server.ts). */
export function LiveLinksList({ listColors }: { listColors?: { strongBgIos: string } }) {
  const now = useNow(30_000)
  const [links, , removeLink] = useLiveLinks(now)
  const [stopping, setStopping] = useState<string>()
  const [failed, setFailed] = useState(false)

  async function stop(link: LiveLink) {
    setStopping(link.link)
    setFailed(false)
    try {
      await stopLink({ data: link.link })
      removeLink(link.link)
    } catch {
      setFailed(true)
    } finally {
      setStopping(undefined)
    }
  }

  return (
    <>
      <List strong inset colors={listColors}>
        {links.length === 0 ? (
          <ListItem title="No live links from this browser" />
        ) : (
          links.map((link) => (
            <ListItem
              key={link.link}
              title={link.name ?? 'Asset'}
              subtitle={`Until ${formatTime(link.expiresAt, now)}`}
              after={
                <Button small rounded outline disabled={stopping === link.link} onClick={() => void stop(link)}>
                  Stop
                </Button>
              }
            />
          ))
        )}
      </List>
      {failed && (
        <p className="px-8 text-sm text-red-500" role="alert">
          Couldn't stop the link. Try again.
        </p>
      )}
      <BlockFooter>
        Links made with Share in this browser. Stopping one ends it at once; a page that's already open goes blank within a
        minute.
      </BlockFooter>
    </>
  )
}
