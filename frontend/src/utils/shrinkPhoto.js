/*
 * Phase 22: review photos are checked and shrunk in the browser before they
 * are sent (docs/backend/PHASE22_CONTRACT.md §2).
 *
 * - photoKind() reads the file's first bytes: a JPEG, PNG or WebP photo is
 *   recognised by its content, never by its name or the type the browser
 *   guessed from the name (a text file renamed photo.jpg is refused).
 * - shrinkPhoto() draws the photo on a canvas, at most 1600 pixels on its
 *   longest side, and saves it again: a smaller upload on mobile data, and
 *   the hidden data (GPS location, camera) is left behind. A PNG stays a PNG
 *   (it may be transparent); JPEG and WebP become JPEG. If anything fails
 *   (an old browser, a photo the browser can't decode), the original file is
 *   sent and the server cleans it, as it does every photo anyway.
 */

export const MAX_PHOTO_SIDE = 1600
export const PHOTO_TYPES = 'image/jpeg,image/png,image/webp'

/** 'jpeg' | 'png' | 'webp' from the file's first 12 bytes, or null for anything else. */
export async function photoKind(file) {
  let bytes
  try {
    bytes = new Uint8Array(await readHead(file.slice(0, 12)))
  } catch {
    return null
  }
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'png'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}

function readHead(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/** "IMG_0042.HEIC.webp" + "jpg" → "IMG_0042.HEIC.jpg" (the name the shopper sees stays recognisable). */
const renamed = (name, extension) => `${(name || 'photo').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'photo'}.${extension}`

/**
 * The photo as a File ready to send: shrunk and saved again when the browser
 * can, else the original. `kind` comes from photoKind().
 */
export async function shrinkPhoto(file, kind) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    const type = kind === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85))
    if (!blob || blob.type !== type) return file
    return new File([blob], renamed(file.name, kind === 'png' ? 'png' : 'jpg'), { type, lastModified: Date.now() })
  } catch {
    return file
  } finally {
    bitmap?.close?.()
  }
}
