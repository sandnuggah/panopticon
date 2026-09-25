// Asset photos. Traccar accepts JPEG, PNG, GIF or WebP up to 500 KB; phone photos are several MB,
// so the browser crops and shrinks them first.

export const MAX_IMAGE_BYTES = 500_000

/** Big enough for a sharp avatar on any screen, small enough to stay well under the limit. */
const SIZE = 512

/** Crops a photo to a centred square (avatars are round) and shrinks it. Returns a JPEG. */
export async function prepareAssetImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const size = Math.min(SIZE, side)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    // JPEG has no transparency; without this, transparent areas turn black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
    for (const quality of [0.85, 0.7, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob
    }
    throw new Error('Image too large')
  } finally {
    bitmap.close()
  }
}

/** The image type from the file's first bytes, if it's one Traccar accepts. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}
