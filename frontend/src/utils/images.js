/*
 * Responsive product photos (phase 9). For photos uploaded in the admin, the
 * API makes smaller copies next to the original (at most 320 and 960 pixels
 * wide) and lists them as `variants: { "320": url, "960": url }`. The page
 * offers them to the browser with `srcset` + `sizes`, and the browser picks
 * the smallest copy that still looks sharp on this screen: a phone showing a
 * product card downloads a 320-pixel photo, not the 3,000-pixel original.
 *
 * The original stays in `src` (and in the srcset, see srcSetOf): browsers without srcset, photos without
 * copies (DummyJSON's, or uploads made where the server couldn't resize),
 * and the DummyJSON demo (no variants at all) work exactly as before.
 */

export const IMAGE_WIDTHS = [320, 960]

/**
 * How wide the photo is shown, for the browser to choose a copy before the
 * page's CSS has loaded. Matches ProductGrid.css / ProductCard.css /
 * ProductDetailsPage.css: two cards per row on phones and four from 900 px
 * (about 300 px each); list cards are about 13rem; the gallery is the
 * screen's width on phones and about half the 1,280 px container from 900 px.
 */
export const IMAGE_SIZES = {
  card: '(min-width: 900px) 300px, 50vw',
  listCard: '(min-width: 640px) 208px, 30vw',
  gallery: '(min-width: 900px) 600px, 100vw',
}

// Only addresses the page may load: the store's own /media/… or https (no spaces or commas, which would break srcset).
const isImageUrl = (value) => typeof value === 'string' && /^(https:\/\/|\/media\/)[^\s,]+$/.test(value)

/** The API's `variants` → { 320: url, 960: url } with only safe entries, or null. */
export function normalizeImageVariants(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const variants = {}
  for (const width of IMAGE_WIDTHS) if (isImageUrl(raw[width])) variants[width] = raw[width]
  return Object.keys(variants).length > 0 ? variants : null
}

/**
 * The srcset for a photo: its copies, plus the original. The API only makes a
 * copy when the original is WIDER than it (never upscaled), so the copies
 * also say how big the original is at least: with a 960 copy it is wider than
 * 960 (listed as 1600w), with only a 320 copy it is at most 960 wide (listed
 * as 960w). Without the original, a photo with only a 320 copy would look
 * blurry in the 600-pixel gallery.
 * → "a-320.webp 320w, a-960.webp 960w, a.jpg 1600w", or undefined (no copies: no srcset).
 */
export function srcSetOf(variants, original) {
  if (!variants) return undefined
  const entries = IMAGE_WIDTHS.filter((width) => variants[width]).map((width) => `${variants[width]} ${width}w`)
  if (entries.length === 0) return undefined
  if (isImageUrl(original)) entries.push(`${original} ${variants[960] ? 1600 : 960}w`)
  return entries.join(', ')
}

/** `srcSet` and `sizes` props for an <img> of `original` (none when there are no copies). */
export function responsiveImageProps(original, variants, sizes) {
  const srcSet = srcSetOf(variants, original)
  return srcSet ? { srcSet, sizes } : {}
}

/** The smallest copy (for 80-pixel thumbnails), or the original. */
export const smallestImage = (original, variants) => variants?.[IMAGE_WIDTHS[0]] ?? original
