import type { LatLon } from '../../lib/segments'

/** A circle of `radius` metres around `center`, as a closed ring of [lon, lat]. */
export function circle(center: LatLon, radius: number): [number, number][] {
  const STEPS = 32
  const metresPerDegreeLat = 111_320
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos((center.lat * Math.PI) / 180)
  return Array.from({ length: STEPS + 1 }, (_, step) => {
    const angle = (step / STEPS) * 2 * Math.PI
    return [center.lon + (Math.cos(angle) * radius) / metresPerDegreeLon, center.lat + (Math.sin(angle) * radius) / metresPerDegreeLat]
  })
}
