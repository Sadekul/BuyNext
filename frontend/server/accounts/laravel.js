import { laravel } from '../http.js'

/*
 * Accounts from BuyNest's Laravel API (backend/, docs/backend/API_CONTRACT.md).
 *   customers: /api/v1/auth/*, /api/v1/me
 *   admins:    /api/admin/v1/auth/*, /api/admin/v1/me (a separate table and separate tokens)
 *
 * The API speaks snake_case; the browser gets the storefront's camelCase.
 * Error answers are passed on with only safe keys (message, errors, code, data),
 * with field names translated so forms can highlight the right input.
 */

const FIELD_NAMES = {
  first_name: 'firstName',
  last_name: 'lastName',
  accept_terms: 'acceptTerms',
  password_confirmation: 'confirmPassword',
  is_active: 'isActive',
}
const camelErrors = (errors) =>
  errors && typeof errors === 'object' ? Object.fromEntries(Object.entries(errors).map(([field, messages]) => [FIELD_NAMES[field] ?? field, messages])) : undefined

const codeInfo = (data) => data && { email: data.email, expiresIn: data.expires_in, resendIn: data.resend_in }

function failed({ status, data }) {
  const body = { message: data?.message ?? 'The request failed.' }
  if (data?.errors) body.errors = camelErrors(data.errors)
  if (data?.code) body.code = data.code
  if (typeof data?.permission === 'string') body.permission = data.permission // 403 permission_denied (admin roles)
  if (data?.data) body.data = codeInfo(data.data)
  return { ok: false, status, body }
}

/*
 * Phase 6: the customer's group ({ name, discount_percent }), so the store can
 * say "Wholesale price: 10% off". Answers without one (sign-in, an older API)
 * leave `group` out.
 */
const customerGroup = (group) =>
  group && typeof group === 'object' && typeof group.name === 'string'
    ? { name: group.name, discountPercent: Number(group.discount_percent ?? 0) || 0 }
    : undefined

export const customerProfile = (customer) => ({
  id: customer.id,
  firstName: customer.first_name,
  lastName: customer.last_name,
  email: customer.email,
  phone: customer.phone,
  emailVerified: customer.email_verified === true,
  role: 'customer',
  ...(customerGroup(customer.group) && { group: customerGroup(customer.group) }),
  // Phase 7: whether the customer gets the newsletter (left out by an older API).
  ...(typeof customer.newsletter === 'boolean' && { newsletter: customer.newsletter }),
})
/*
 * Phase 4: the admin's role ({ id, name }) and permission keys, so the admin
 * app can hide what the role can't do (the API still refuses it). Without
 * them (an older API, or a sign-in answer) `permissions` is left out and the
 * app shows everything.
 */
const adminProfile = (admin) => ({
  id: admin.id,
  name: admin.name,
  firstName: admin.name,
  lastName: '',
  email: admin.email,
  role: admin.role && typeof admin.role === 'object' ? { id: admin.role.id, name: admin.role.name } : 'admin',
  ...(Array.isArray(admin.permissions) && { permissions: admin.permissions.filter((key) => typeof key === 'string') }),
})
const tokensOf = (tokens) => ({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token })
const str = (value) => (typeof value === 'string' ? value : undefined)

/** Sign-in style answer: { data: { customer|admin, tokens } } → profile + tokens. */
const signedIn = (result, account, toProfile) =>
  result.status === 200 ? { ok: true, profile: toProfile(result.data.data[account]), tokens: tokensOf(result.data.data.tokens) } : failed(result)

/** "We emailed you a code" style answer → { ok, data: { email, expiresIn, resendIn }, message }. */
const codeSent = (result) =>
  result.status === 200 || result.status === 201
    ? {
        ok: true,
        status: result.status,
        data: {
          email: result.data.data?.email,
          expiresIn: result.data.data?.expires_in,
          resendIn: result.data.data?.resend_in,
          message: result.data.message,
        },
      }
    : failed(result)

function sessionApi(prefix, account, toProfile) {
  return {
    async login(body, remember, request) {
      const result = await laravel(`${prefix}/auth/login`, {
        method: 'POST',
        request,
        body: { email: str(body.email), password: str(body.password), remember },
      })
      return signedIn(result, account, toProfile)
    },
    async me(token, request) {
      const result = await laravel(`${prefix}/me`, { token, request })
      return result.status === 200 ? { ok: true, profile: toProfile(result.data.data) } : failed(result)
    },
    async refresh(refreshToken, remember, request) {
      const result = await laravel(`${prefix}/auth/refresh`, { method: 'POST', request, body: { refresh_token: refreshToken } })
      return result.status === 200 ? { ok: true, tokens: tokensOf(result.data.data.tokens) } : failed(result)
    },
    async logout(token, request) {
      if (token) await laravel(`${prefix}/auth/logout`, { method: 'POST', token, request })
      return { ok: true }
    },
  }
}

export const laravelAccounts = {
  name: 'laravel',
  customer: {
    ...sessionApi('/api/v1', 'customer', customerProfile),

    async updateProfile(token, body, request) {
      const changes = {
        first_name: str(body.firstName),
        last_name: str(body.lastName),
        phone: str(body.phone),
        // Phase 7: the newsletter switch in the account (no confirmation email: the address is verified).
        ...(typeof body.newsletter === 'boolean' && { newsletter: body.newsletter }),
      }
      const result = await laravel('/api/v1/me', { method: 'PATCH', token, request, body: changes })
      return result.status === 200 ? { ok: true, profile: customerProfile(result.data.data) } : failed(result)
    },

    async register(body, request) {
      const result = await laravel('/api/v1/auth/register', {
        method: 'POST',
        request,
        body: {
          first_name: str(body.firstName),
          last_name: str(body.lastName),
          email: str(body.email),
          phone: str(body.phone),
          password: str(body.password),
          password_confirmation: str(body.confirmPassword),
          accept_terms: body.acceptTerms === true,
        },
      })
      return codeSent(result)
    },

    async verifyEmail(body, remember, request) {
      const result = await laravel('/api/v1/auth/verify-email', {
        method: 'POST',
        request,
        body: { email: str(body.email), code: str(body.code), remember },
      })
      return signedIn(result, 'customer', customerProfile)
    },

    async resendCode(body, request) {
      const purpose = body.purpose === 'reset_password' ? 'reset_password' : 'verify_email'
      return codeSent(await laravel('/api/v1/auth/resend-code', { method: 'POST', request, body: { email: str(body.email), purpose } }))
    },

    async forgotPassword(body, request) {
      return codeSent(await laravel('/api/v1/auth/forgot-password', { method: 'POST', request, body: { email: str(body.email) } }))
    },

    async resetPassword(body, request) {
      const result = await laravel('/api/v1/auth/reset-password', {
        method: 'POST',
        request,
        body: { email: str(body.email), code: str(body.code), password: str(body.password), password_confirmation: str(body.confirmPassword) },
      })
      return result.status === 200 ? { ok: true, data: { message: result.data.message } } : failed(result)
    },
  },

  admin: {
    ...sessionApi('/api/admin/v1', 'admin', adminProfile),

    async listCustomers(token, { search, status, page, perPage }, request) {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      params.set('page', String(page))
      params.set('per_page', String(perPage))
      const result = await laravel(`/api/admin/v1/customers?${params}`, { token, request })
      if (result.status !== 200) return failed(result)
      return { ok: true, data: { customers: result.data.data.map(adminCustomer), total: result.data.meta.total } }
    },

    async updateCustomer(token, id, body, request) {
      const result = await laravel(`/api/admin/v1/customers/${id}`, {
        method: 'PATCH',
        token,
        request,
        body: { is_active: body.isActive },
      })
      return result.status === 200 ? { ok: true, data: adminCustomer(result.data.data) } : failed(result)
    },
  },
}

function adminCustomer(customer) {
  return {
    id: customer.id,
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    emailVerified: customer.email_verified_at !== null,
    isActive: customer.is_active,
    createdAt: customer.created_at,
    lastLoginAt: customer.last_login_at,
  }
}
