import { api, request } from './client'

/*
 * Phase 9 (docs/backend/PHASE9_CONTRACT.md §1, §3, §7) through the admin
 * service (frontend/server/adminSecurityApi.js): two-step sign-in, backups,
 * and stock alerts. The session's tokens stay in HttpOnly cookies; the
 * sign-in challenge (5 minutes, single use, not a session) is the only token
 * this app ever holds.
 */

export const securityKeys = {
  backups: ['backups'],
}

/** Second sign-in step: { challenge, code } or { challenge, recoveryCode }, plus remember → the admin (session cookies set). */
export const verifyTwoFactor = (body) => api.post('/api/admin/auth/two-factor', body)

/** Starts enrolment → { secret, otpauthUrl, qrSvg } (not active until confirmed). */
export const startTwoFactor = () => api.post('/api/admin/me/two-factor', {})
/** Confirms with a code from the app → { recoveryCodes } (shown once). */
export const confirmTwoFactor = (code) => api.post('/api/admin/me/two-factor/confirm', { code })
/** A new set of recovery codes (the old ones stop working) → { recoveryCodes }. */
export const regenerateRecoveryCodes = (password) => api.post('/api/admin/me/two-factor/recovery-codes', { password })
/** Turns two-step off (refused while the store requires it). */
export const disableTwoFactor = (password, code) => request('/api/admin/me/two-factor', { method: 'DELETE', body: { password, code } })
/** Owner only: turns another admin's two-step off and signs them out everywhere. */
export const resetAdminTwoFactor = (id) => api.post(`/api/admin/admins/${id}/two-factor/reset`, {})

/** System → Backups (backups.view). */
export const getBackups = ({ signal } = {}) => api.get('/api/admin/backups', { signal })
export const runBackup = () => api.post('/api/admin/backups', {}, { timeout: 330_000 })
/** A download link valid for a few minutes → { url, expiresAt }. */
export const backupDownloadLink = (name) => api.post(`/api/admin/backups/${encodeURIComponent(name)}/download`, {})
