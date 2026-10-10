import type { EditError } from '../server/manage.server'

/** What to tell the user when Traccar refuses or fails an asset change. */
export function editErrorMessage(error: EditError): string {
  switch (error) {
    case 'not-allowed':
      return "Your Traccar account isn't allowed to make this change."
    case 'tracker-id-taken':
      return 'Another device in Traccar already uses that tracker ID.'
    case 'not-found':
      return 'This asset no longer exists in Traccar.'
    case 'invalid-image':
      return "Traccar didn't accept that image. Try a different photo."
    case 'alerts-full':
      return 'Too many phones get alerts for this asset. Turn alerts off on a phone you no longer use.'
    case 'unavailable':
      return "Traccar couldn't save the change. Try again in a moment."
  }
}
