/*
 * Phase 9 admin two-step (docs/backend/PHASE9_CONTRACT.md §1, implementation
 * notes part A): the admin profile's two-step fields, shared by the admin
 * profile mapping (accounts/laravel.js) and adminSecurityApi.js.
 *
 * The API's admin has `two_factor_enabled` (everywhere) and, on GET /me and
 * sign-in answers, `two_factor: { enabled, confirmed_at, recovery_codes_left,
 * required }`. The admin app gets:
 *   twoFactorEnabled          two-step is on for this admin
 *   twoFactorRequiredByStore  the store requires it for every admin (Owner setting)
 *   twoFactorSetupRequired    required but not on yet: only the forced-setup screen
 *   recoveryCodesLeft         unused recovery codes
 * Older answers without them: nothing is added.
 */
export function twoFactorState(admin) {
  const details = admin?.two_factor && typeof admin.two_factor === 'object' ? admin.two_factor : null
  if (!details && typeof admin?.two_factor_enabled !== 'boolean') return {}
  const enabled = details ? details.enabled === true : admin.two_factor_enabled === true
  if (!details) return { twoFactorEnabled: enabled }
  const required = details.required === true
  return {
    twoFactorEnabled: enabled,
    twoFactorRequiredByStore: required,
    twoFactorSetupRequired: required && !enabled,
    ...(Number.isInteger(details.recovery_codes_left) && { recoveryCodesLeft: details.recovery_codes_left }),
  }
}
