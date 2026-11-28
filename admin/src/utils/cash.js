import { CARRIERS } from './orders'

/*
 * Phase 21 (docs/backend/PHASE21_CONTRACT.md §2): courier payments and the
 * cash reports' words. The API is the judge; these only catch what can be
 * seen before sending, with the same words.
 */

/** Every courier a payment can come from (the admin's carrier list's Bangladesh couriers). */
export const PAYOUT_COURIERS = ['steadfast', 'pathao', 'redx', 'paperfly', 'sundarban'].map((code) => ({ code, label: CARRIERS[code] }))
/** "steadfast" → "Steadfast" (the API's label when it sent one). */
export const courierName = (code, label) => label || CARRIERS[code] || code || 'the courier'

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const MAX_AMOUNT = 9_999_999_999.99

export const emptyPayoutForm = (today) => ({ carrier: '', amount: '', fees: '', receivedOn: today, reference: '', note: '' })
/** A saved payment → the dialog's form. */
export const payoutToForm = (payout) => ({
  carrier: payout.carrier ?? '',
  amount: String(payout.amount ?? ''),
  fees: payout.fees === null || payout.fees === undefined ? '' : String(payout.fees),
  receivedOn: payout.receivedOn ?? '',
  reference: payout.reference ?? '',
  note: payout.note ?? '',
})

/** The form's problems ({ field: [message] }); `today` is the store's today (YYYY-MM-DD). */
export function payoutErrors(form, today) {
  const errors = {}
  if (!PAYOUT_COURIERS.some((courier) => courier.code === form.carrier)) errors.carrier = ['Choose the courier that paid you.']
  const amount = Number(form.amount)
  if (form.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT || !hasCents(amount)) errors.amount = ['Enter the amount received, more than 0, with at most 2 decimals.']
  if (form.fees.trim() !== '') {
    const fees = Number(form.fees)
    if (!Number.isFinite(fees) || fees < 0 || fees > MAX_AMOUNT || !hasCents(fees)) errors.fees = ['Enter the fees the courier kept (0 or more, at most 2 decimals), or leave it empty.']
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.receivedOn)) errors.receivedOn = ['Enter the date the money arrived.']
  else if (form.receivedOn < '2020-01-01') errors.receivedOn = ['Enter a date from 2020 on.']
  else if (today && form.receivedOn > today) errors.receivedOn = ["The date can't be in the future."]
  if (form.reference.trim().length > 100) errors.reference = ['Keep the reference to 100 characters.']
  if (form.note.trim().length > 500) errors.note = ['Keep the note to 500 characters.']
  return errors
}

/** A checked form → what the admin service takes (empty optional fields as null). */
export const toPayoutValues = (form) => ({
  carrier: form.carrier,
  amount: Math.round(Number(form.amount) * 100) / 100,
  fees: form.fees.trim() === '' ? null : Math.round(Number(form.fees) * 100) / 100,
  receivedOn: form.receivedOn,
  reference: form.reference.trim() || null,
  note: form.note.trim() || null,
})

/** The older-than filter of Still to collect. */
export const OLDER_THAN = [
  { value: '', label: 'Any age' },
  { value: '7', label: 'Older than 7 days' },
  { value: '14', label: 'Older than 14 days' },
  { value: '30', label: 'Older than 30 days' },
]
