import { useEffect, useRef, useState } from 'react'

// Your own position, for "Show my position" on the map. It stays in the browser: it's only drawn,
// never sent anywhere. Off each time the app opens; the browser asks for permission the first time.

export type MyPosition = { lat: number; lon: number; accuracy: number }

/**
 * While `on`, your position as the browser reports it (null until the first fix). `note` explains
 * why it switched itself off (permission refused, or no fix), for a moment.
 */
export function useMyPosition(on: boolean, turnOff: () => void): { position: MyPosition | null; note?: string } {
  const [position, setPosition] = useState<MyPosition | null>(null)
  const [note, setNote] = useState<string>()
  const turnOffRef = useRef(turnOff)
  turnOffRef.current = turnOff

  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(undefined), 4_000)
    return () => clearTimeout(timer)
  }, [note])

  useEffect(() => {
    if (!on) {
      setPosition(null)
      return
    }
    if (!navigator.geolocation) {
      setNote("This browser can't share your location")
      turnOffRef.current()
      return
    }
    let found = false
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        found = true
        setNote(undefined)
        setPosition({ lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy })
      },
      (error) => {
        // Once found, a slow update just keeps the last position.
        if (found && error.code !== error.PERMISSION_DENIED) return
        setNote(
          error.code === error.PERMISSION_DENIED
            ? 'Location is off for this site. Allow it in your browser settings.'
            : "Couldn't find your location",
        )
        turnOffRef.current()
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [on])

  return { position, note }
}
