import { safeProfile, upstream } from '../http.js'
import { serverMessage } from '../i18n.js'
import { REMEMBER_MINUTES, SHORT_MINUTES } from '../session.js'

/*
 * Accounts from DummyJSON's public demo users (e.g. emilys / emilyspass).
 * Nothing is saved: sign-up, password reset, and blocking customers need the
 * Laravel backend (VITE_ACCOUNTS_BACKEND=laravel).
 * Admins are the demo users whose role is "admin".
 */

const failed = ({ status, data }) => ({ ok: false, status, body: { message: data?.message ?? 'The request failed.' } })
const tokensOf = (data) => ({ accessToken: data.accessToken, refreshToken: data.refreshToken })
// Phase 13: the request is the last argument of every account call (its language: server/i18n.js).
const notAvailable = async (...args) => ({ ok: false, status: 404, body: { message: serverMessage(args.at(-1), 'demoOnly') } })
const minutes = (remember) => (remember ? REMEMBER_MINUTES : SHORT_MINUTES)
const adminProfile = (profile) => ({ ...profile, name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') })

async function signIn({ username, password }, remember, request) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, status: 400, body: { message: serverMessage(request, 'usernamePassword') } }
  }
  const login = await upstream('/auth/login', { method: 'POST', body: { username, password, expiresInMins: minutes(remember) } })
  if (login.status !== 200) return failed(login)
  // The login reply lacks the role and contact details: fetch the full profile once.
  const me = await upstream('/auth/me', { token: login.data.accessToken })
  return { ok: true, profile: safeProfile(me.status === 200 ? me.data : login.data), tokens: tokensOf(login.data) }
}

async function me(token) {
  const result = await upstream('/auth/me', { token })
  return result.status === 200 ? { ok: true, profile: safeProfile(result.data) } : failed(result)
}

async function refresh(refreshToken, remember) {
  const result = await upstream('/auth/refresh', { method: 'POST', body: { refreshToken, expiresInMins: minutes(remember) } })
  return result.status === 200 ? { ok: true, tokens: tokensOf(result.data) } : failed(result)
}

// DummyJSON has no server-side sign-out; deleting the cookies ends the session.
const logout = async () => ({ ok: true })

const PROFILE_FIELDS = ['firstName', 'lastName', 'email']

export const dummyJsonAccounts = {
  name: 'dummyjson',
  customer: {
    login: signIn,
    me,
    refresh,
    logout,
    // SIMULATED: DummyJSON returns the change but doesn't save it.
    async updateProfile(token, body) {
      const current = await me(token)
      if (!current.ok) return current
      const changes = Object.fromEntries(PROFILE_FIELDS.filter((field) => typeof body[field] === 'string').map((field) => [field, body[field]]))
      const result = await upstream(`/users/${current.profile.id}`, { method: 'PUT', body: changes })
      return result.status === 200 ? { ok: true, profile: safeProfile(result.data) } : failed(result)
    },
    register: notAvailable,
    verifyEmail: notAvailable,
    resendCode: notAvailable,
    forgotPassword: notAvailable,
    resetPassword: notAvailable,
  },
  admin: {
    async login(body, remember) {
      const result = await signIn(body, remember)
      if (result.ok && result.profile.role !== 'admin') {
        return { ok: false, status: 403, body: { message: 'This account is not a shop admin. Sign in with an admin account.' } }
      }
      return result.ok ? { ...result, profile: adminProfile(result.profile) } : result
    },
    async me(token) {
      const result = await me(token)
      if (result.ok && result.profile.role !== 'admin') return { ok: false, status: 403, body: { message: 'This account does not have admin access.' } }
      return result.ok ? { ok: true, profile: adminProfile(result.profile) } : result
    },
    refresh,
    logout,
  },
}
