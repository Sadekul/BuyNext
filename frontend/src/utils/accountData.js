import { ACCOUNT_STORES } from '../constants/storageKeys'
import { ownerStorageKey, removeKey } from './storage'

/**
 * Deletes one account's saved cart, wishlist, and demo orders from this
 * browser. Called when a session that was NOT "remembered" ends (sign-out,
 * expiry, or closing the browser), so an untrusted device keeps nothing of
 * the account. "Remember me" keeps them for the next sign-in.
 */
export function removeAccountData(userId) {
  for (const storageKey of ACCOUNT_STORES) removeKey(ownerStorageKey(storageKey, userId))
}
