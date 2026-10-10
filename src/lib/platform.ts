// Konsta UI draws iOS or Material components. Android gets Material; iPhones, iPads and everything
// else (desktops included) get iOS. Decided from the User-Agent, on the server too, so the first
// render already has the right look.

export type Platform = 'ios' | 'material'

export function platformFor(userAgent: string): Platform {
  return /\bAndroid\b/i.test(userAgent) ? 'material' : 'ios'
}
