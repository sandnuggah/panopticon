import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Block, BlockFooter, Button, List, ListInput } from 'konsta/react'
import { editErrorMessage } from '../lib/editErrors'
import { addAsset } from '../server/manage.functions'

type Props = {
  listColors?: { strongBgIos: string }
  /** Called with the new asset's id, to go on to its page, where a photo can be added. */
  onAdded: (id: number) => void
}

/** Adds an asset: a name and the ID its tracker reports to Traccar. */
export function AddAssetForm({ listColors, onAdded }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await addAsset({
        data: { name: String(form.get('name') ?? ''), trackerId: String(form.get('trackerId') ?? '') },
      })
      if (result.ok) {
        // The map picks the new asset up too.
        void router.invalidate()
        onAdded(result.id)
      } else {
        setError(editErrorMessage(result.error))
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form method="post" onSubmit={onSubmit}>
      <List strong inset colors={listColors}>
        <ListInput label="Name" name="name" required maxLength={128} autoComplete="off" placeholder="Betty" />
        <ListInput
          label="Tracker ID"
          name="trackerId"
          required
          maxLength={128}
          pattern="[!-~]+"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          placeholder="IMEI, without spaces"
        />
      </List>
      <BlockFooter>
        The ID the tracker reports to Traccar, usually its IMEI. It's often on a label on the tracker, or in its manual. The
        tracker also needs to be set up to send its position to your Traccar server.
      </BlockFooter>
      {error && (
        <p className="px-8 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
      <Block>
        <Button large rounded type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add asset'}
        </Button>
      </Block>
    </form>
  )
}
