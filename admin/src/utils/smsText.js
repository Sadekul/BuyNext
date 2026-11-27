/*
 * Phase 20: how many SMS a text takes, counted like the backend's
 * SmsText::measure() (docs/backend/PHASE20_CONTRACT.md §1 "Services").
 *
 * An SMS carries 140 bytes. Text made only of the GSM-7 alphabet (plain
 * English letters, digits, common punctuation) packs 7 bits per character:
 * 160 characters in one SMS. A longer text is split into parts, and each part
 * gives up room to a header that joins them back: 153 characters per part.
 *
 * One character outside GSM-7 (any Bangla letter, "৳", an emoji, curly
 * quotes) switches the whole text to Unicode (UCS-2, 2 bytes a character):
 * 70 characters in one SMS, 67 per part when longer.
 *
 * A few GSM-7 characters live in an "extension" table and take two places
 * (an escape, then the character): ^ { } [ ] ~ \ | € and the form feed.
 * Unicode counts UTF-16 code units, as phones do: an emoji takes two.
 */

// The GSM 03.38 basic alphabet (without the escape character itself).
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
)
// The extension table: each one costs two places.
const GSM_EXTENSION = new Set('^{}\\[~]|€\f')

export const GSM_SINGLE = 160
export const GSM_PART = 153
export const UNICODE_SINGLE = 70
export const UNICODE_PART = 67

/** Whether every character of `text` is in the GSM-7 alphabet (basic or extension). */
export function isGsm(text) {
  for (const character of text) if (!GSM_BASIC.has(character) && !GSM_EXTENSION.has(character)) return false
  return true
}

// As the backend: an empty text still counts as one SMS.
const segmentsFor = (length, single, part) => (length <= single ? 1 : Math.ceil(length / part))

/**
 * → { encoding: 'gsm' | 'unicode', length, segments }. `length` is in the
 * encoding's units (GSM-7 places, or UTF-16 code units).
 */
export function measureSms(text = '') {
  const body = String(text ?? '')
  if (isGsm(body)) {
    let length = 0
    for (const character of body) length += GSM_EXTENSION.has(character) ? 2 : 1
    return { encoding: 'gsm', length, segments: segmentsFor(length, GSM_SINGLE, GSM_PART) }
  }
  return { encoding: 'unicode', length: body.length, segments: segmentsFor(body.length, UNICODE_SINGLE, UNICODE_PART) }
}

/** The counter under a template: "72 characters · 1 SMS" / "Unicode (Bangla): 2 SMS · 95 characters". */
export function smsCountText(text) {
  const { encoding, length, segments } = measureSms(text)
  const characters = `${length} ${length === 1 ? 'character' : 'characters'}`
  return encoding === 'gsm' ? `${characters} · ${segments} SMS` : `Unicode (Bangla): ${segments} SMS · ${characters}`
}
