import { laravel, pick } from '../http.js'
import { camelPath } from './laravel.js'

/*
 * Phase 4 of the admin (docs/backend/PHASE4_CONTRACT.md) from BuyNest's
 * Laravel admin API: admin users, roles and permissions, the audit log, CMS
 * pages, the home page content, reports, and store settings.
 *
 * Same conventions as shop/admin.js: snake_case in, camelCase out, money as
 * numbers for the browser, only listed fields copied either way. A 403
 * `permission_denied` keeps its code and the missing permission, so the admin
 * app can say which permission the role lacks.
 *
 * Each function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const money = (value) => (value === null || value === undefined || value === '' ? null : Number(value))
const text = (value) => (typeof value === 'string' ? value : '')

// Laravel field names → the admin forms' names (anything else: camelCase path).
const FIELD_NAMES = { role_id: 'roleId', is_active: 'isActive', is_published: 'isPublished', meta_title: 'metaTitle', meta_description: 'metaDescription' }

const fieldName = (field) => FIELD_NAMES[field] ?? camelPath(field)

export function failed({ status, data }, toField = fieldName) {
  const body = { message: data?.message ?? 'The request failed.' }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).map(([field, messages]) => [toField(field), messages]))
  }
  if (typeof data?.code === 'string') body.code = data.code
  if (typeof data?.permission === 'string') body.permission = data.permission
  return { ok: false, status, body }
}
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result))
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
const paged = (data, key, map, { limit, skip }) => ({ [key]: listOf(data).map(map), total: data?.meta?.total ?? listOf(data).length, limit, skip, live: true })

/** ?page&per_page from the admin's limit/skip, plus any filters that have a value. */
function listParams({ limit = 20, skip = 0, ...filters }) {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

// ---- admin users and roles ----

const roleRef = (raw) => (raw && typeof raw === 'object' ? { id: raw.id, name: raw.name } : null)

/** AdminResource → the admin app's admin user. Never a password or token. */
export function adminUser(raw) {
  return {
    id: raw.id,
    name: raw.name ?? '',
    email: raw.email ?? '',
    role: roleRef(raw.role),
    roleId: raw.role_id ?? raw.role?.id ?? null,
    isActive: raw.is_active !== false,
    lastLoginAt: raw.last_login_at ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    // Phase 9: whether two-step sign-in is on (left out by an older API).
    ...(typeof raw.two_factor_enabled === 'boolean' && { twoFactorEnabled: raw.two_factor_enabled }),
  }
}

const ADMIN_FIELDS = { name: 'name', email: 'email', roleId: 'role_id', isActive: 'is_active', password: 'password' }
const toBody = (values, fields) => Object.fromEntries(Object.entries(values).filter(([field]) => fields[field]).map(([field, value]) => [fields[field], value]))

/** RoleResource → the admin app's role. */
export function adminRole(raw) {
  return {
    id: raw.id,
    name: raw.name ?? '',
    description: raw.description ?? '',
    permissions: Array.isArray(raw.permissions) ? raw.permissions.filter((key) => typeof key === 'string') : [],
    isSystem: raw.is_system === true,
    adminCount: raw.admins_count ?? raw.admin_count ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}
const ROLE_FIELDS = { name: 'name', description: 'description', permissions: 'permissions' }

/*
 * GET /permissions → [{ label, permissions: [{ key, label }] }]. The contract
 * names the content ("the grouped key list with labels") but not the exact
 * nesting, so a few likely shapes are read: a list of groups, or an object
 * of group → keys; each key a string or { key, label }.
 */
export function permissionGroups(data) {
  const toKey = (entry) => (typeof entry === 'string' ? { key: entry, label: entry } : entry && typeof entry.key === 'string' ? { key: entry.key, label: entry.label ?? entry.key } : null)
  const toGroup = (label, entries) => ({ label, permissions: (Array.isArray(entries) ? entries : Object.entries(entries ?? {}).map(([key, value]) => (typeof value === 'string' ? { key, label: value } : { key, ...value }))).map(toKey).filter(Boolean) })
  const raw = data?.data ?? data
  if (Array.isArray(raw)) {
    return raw.map((group) => toGroup(group.label ?? group.area ?? group.group ?? group.name ?? '', group.permissions ?? group.keys ?? group.items ?? [])).filter((group) => group.permissions.length > 0)
  }
  if (raw && typeof raw === 'object') return Object.entries(raw).map(([label, entries]) => toGroup(label, entries)).filter((group) => group.permissions.length > 0)
  return []
}

// ---- audit log ----

/*
 * `changes` (before/after of the changed fields) → [{ field, before, after }].
 * Read as { before: {…}, after: {…} } or { field: { before|old, after|new } } or { field: [old, new] }.
 */
export function auditChanges(changes) {
  if (!changes || typeof changes !== 'object') return []
  const plain = (value) => (value === undefined ? null : value)
  if ((changes.before && typeof changes.before === 'object') || (changes.after && typeof changes.after === 'object')) {
    const before = changes.before ?? {}
    const after = changes.after ?? {}
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((field) => ({ field, before: plain(before[field]), after: plain(after[field]) }))
  }
  return Object.entries(changes).map(([field, value]) => {
    if (Array.isArray(value) && value.length === 2) return { field, before: plain(value[0]), after: plain(value[1]) }
    if (value && typeof value === 'object' && ('before' in value || 'after' in value || 'old' in value || 'new' in value)) {
      return { field, before: plain(value.before ?? value.old), after: plain(value.after ?? value.new) }
    }
    return { field, before: null, after: plain(value) }
  })
}

export function auditEntry(raw) {
  return {
    id: raw.id,
    adminId: raw.admin_id ?? raw.admin?.id ?? null,
    adminName: raw.admin?.name ?? raw.admin_name ?? null,
    action: raw.action ?? '',
    subjectType: raw.subject_type ?? null,
    subjectId: raw.subject_id ?? null,
    summary: raw.summary ?? '',
    changes: auditChanges(raw.changes),
    ip: raw.ip ?? null,
    createdAt: raw.created_at ?? null,
  }
}

// ---- content ----

/** PageResource → the admin's CMS page. `body` is the server's sanitized HTML. */
export function contentPage(raw) {
  return {
    id: raw.id,
    slug: raw.slug ?? '',
    title: raw.title ?? '',
    body: raw.body ?? '',
    metaTitle: raw.meta_title ?? '',
    metaDescription: raw.meta_description ?? '',
    isPublished: raw.is_published === true,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}
const PAGE_FIELDS = { slug: 'slug', title: 'title', body: 'body', metaTitle: 'meta_title', metaDescription: 'meta_description', isPublished: 'is_published' }

const cta = (raw) => (raw && typeof raw === 'object' ? { label: text(raw.label), url: text(raw.url) } : null)

/** Home content (hero, banners, featured products) → camelCase. */
export function homeContent(raw = {}) {
  const hero = raw.hero ?? {}
  return {
    hero: {
      eyebrow: text(hero.eyebrow),
      title: text(hero.title),
      description: text(hero.description),
      primaryCta: cta(hero.primary_cta) ?? { label: '', url: '' },
      secondaryCta: cta(hero.secondary_cta),
      imageUrl: text(hero.image_url),
      imageAlt: text(hero.image_alt),
      highlights: Array.isArray(hero.highlights) ? hero.highlights.map(text) : [],
    },
    banners: (Array.isArray(raw.banners) ? raw.banners : [])
      .map((banner) => ({
        id: banner.id ?? null,
        eyebrow: text(banner.eyebrow),
        title: text(banner.title),
        description: text(banner.description),
        cta: cta(banner.cta) ?? { label: '', url: '' },
        imageUrl: text(banner.image_url),
        imageAlt: text(banner.image_alt),
        tone: banner.tone ?? 'navy',
        position: banner.position ?? 0,
        isActive: banner.is_active !== false,
      }))
      .sort((a, b) => a.position - b.position),
    featuredProductIds: Array.isArray(raw.featured_product_ids) ? raw.featured_product_ids.filter(Number.isInteger) : (raw.featured_products ?? []).map((product) => product.id),
    // Names for the picker, when the API includes the products.
    featuredProducts: (Array.isArray(raw.featured_products) ? raw.featured_products : []).map((product) => ({
      id: product.id,
      title: product.name ?? product.title ?? '',
      sku: product.sku ?? null,
      thumbnail: product.thumbnail_url ?? null,
    })),
  }
}

/** Validated home values (see adminApi.js validateHome) → the API's body. */
export function toHomeBody(home) {
  const toCta = (value) => value && { label: value.label, url: value.url }
  return {
    hero: {
      eyebrow: home.hero.eyebrow,
      title: home.hero.title,
      description: home.hero.description,
      primary_cta: toCta(home.hero.primaryCta),
      secondary_cta: toCta(home.hero.secondaryCta) ?? null,
      image_url: home.hero.imageUrl,
      image_alt: home.hero.imageAlt,
      highlights: home.hero.highlights,
    },
    banners: home.banners.map((banner, index) => ({
      ...(banner.id !== null && banner.id !== undefined && { id: banner.id }),
      eyebrow: banner.eyebrow,
      title: banner.title,
      description: banner.description,
      cta: toCta(banner.cta),
      image_url: banner.imageUrl,
      image_alt: banner.imageAlt,
      tone: banner.tone,
      position: index, // the list order is the position (0-based, like the seed)
      is_active: banner.isActive,
    })),
    featured_product_ids: home.featuredProductIds,
  }
}

// ---- reports ----

const REPORT_MAPS = {
  sales: (data) => ({
    totals: {
      orders: data?.totals?.orders ?? 0,
      units: data?.totals?.units ?? 0,
      gross: money(data?.totals?.gross) ?? 0,
      discounts: money(data?.totals?.discounts) ?? 0,
      shipping: money(data?.totals?.shipping) ?? 0,
      tax: money(data?.totals?.tax) ?? 0,
      refunds: money(data?.totals?.refunds) ?? 0,
      net: money(data?.totals?.net) ?? 0,
      averageOrder: money(data?.totals?.average_order) ?? 0,
    },
    series: (data?.series ?? []).map((point) => ({ period: point.period, orders: point.orders ?? 0, gross: money(point.gross) ?? 0, refunds: money(point.refunds) ?? 0, net: money(point.net) ?? 0 })),
  }),
  products: (data) => ({
    products: (Array.isArray(data) ? data : []).map((row) => ({ productId: row.product_id ?? null, name: row.name ?? '', sku: row.sku ?? null, units: row.units ?? 0, revenue: money(row.revenue) ?? 0 })),
  }),
  customers: (data) => ({
    newCustomers: data?.new_customers ?? 0,
    returningCustomers: data?.returning_customers ?? 0,
    guestOrders: data?.guest_orders ?? 0,
    topCustomers: (data?.top_customers ?? []).map((row) => ({ id: row.id ?? null, name: row.name ?? '', email: row.email ?? '', orders: row.orders ?? 0, spent: money(row.spent) ?? 0 })),
  }),
  coupons: (data) => ({
    // Phase 7 (marketing): automatic rules have no code, only a name.
    coupons: (Array.isArray(data) ? data : []).map((row) => ({
      couponId: row.coupon_id ?? null,
      code: row.code ?? '',
      name: row.name ?? '',
      automatic: row.automatic === true,
      uses: row.uses ?? 0,
      discountTotal: money(row.discount_total) ?? 0,
    })),
  }),
  'low-stock': (data) => ({
    products: (Array.isArray(data) ? data : []).map((row) => ({
      id: row.id,
      title: row.name ?? row.title ?? '',
      sku: row.sku ?? null,
      stock: row.stock_quantity ?? row.stock ?? 0,
      status: row.status ?? null,
      thumbnail: row.thumbnail_url ?? null,
    })),
  }),
}
export const REPORTS = Object.keys(REPORT_MAPS)
export const CSV_REPORTS = ['sales', 'products']

// ---- settings ----

/*
 * Each settings group and its keys: API name → app name, and how values are
 * sent back. Only these keys are read or written.
 */
const SETTINGS = {
  general: { store_name: 'storeName', support_email: 'supportEmail', support_phone: 'supportPhone', address: 'address' },
  shipping: {
    standard_price: 'standardPrice',
    free_shipping_threshold: 'freeShippingThreshold',
    express_price: 'expressPrice',
    next_day_price: 'nextDayPrice',
    enabled_methods: 'enabledMethods',
    // Phase 10 §4: the weight of products without one (table rates).
    default_weight_grams: 'defaultWeightGrams',
  },
  tax: { tax_enabled: 'taxEnabled', tax_rates: 'taxRates', prices_include_tax: 'pricesIncludeTax' },
  checkout: { allowed_countries: 'allowedCountries', guest_checkout: 'guestCheckout', enabled_payment_methods: 'enabledPaymentMethods' },
  inventory: { low_stock_threshold: 'lowStockThreshold' },
  // Phase 5: reviews wait for approval unless this is off.
  catalog: { reviews_require_approval: 'reviewsRequireApproval' },
  // Phase 6: returns (RMA).
  returns: { returns_enabled: 'returnsEnabled', return_window_days: 'returnWindowDays', return_reasons: 'returnReasons' },
  // Phase 9: two-step sign-in for every admin (only the Owner may change it; the API checks).
  security: { require_admin_two_factor: 'requireAdminTwoFactor' },
  // Phase 10 §2: invoice and credit memo PDFs; §6: Google Analytics 4 (null = off).
  documents: { paper_size: 'paperSize', attach_pdf_to_emails: 'attachPdfToEmails' },
  analytics: { ga4_measurement_id: 'ga4MeasurementId' },
  // Phase 11 §4: reward points (Settings → Reward points).
  rewards: {
    enabled: 'enabled',
    earn_rate: 'earnRate',
    point_value: 'pointValue',
    min_redeem: 'minRedeem',
    max_percent: 'maxPercent',
    signup_bonus: 'signupBonus',
    review_bonus: 'reviewBonus',
  },
}
export const SETTINGS_GROUPS = Object.fromEntries(Object.entries(SETTINGS).map(([group, keys]) => [group, Object.values(keys)]))
const MONEY_SETTINGS = ['standardPrice', 'freeShippingThreshold', 'expressPrice', 'nextDayPrice']
// Phase 11 §4: decimal settings the API may send as strings ("1.00", "0.0100").
const NUMBER_SETTINGS = ['earnRate', 'pointValue']

export function storeSettings(raw = {}) {
  const fromValue = (key, value) => {
    if (MONEY_SETTINGS.includes(key) || NUMBER_SETTINGS.includes(key)) return money(value)
    if (key === 'taxRates') return (Array.isArray(value) ? value : []).map((rate) => ({ country: text(rate?.country), rate: money(rate?.rate) ?? 0 }))
    return value ?? null
  }
  return Object.fromEntries(
    Object.entries(SETTINGS).map(([group, keys]) => [
      group,
      Object.fromEntries(Object.entries(keys).filter(([apiKey]) => raw?.[group]?.[apiKey] !== undefined).map(([apiKey, key]) => [key, fromValue(key, raw[group][apiKey])])),
    ]),
  )
}

/** Validated settings changes ({ group: { key: value } }, app names) → the API's names; money as 2-decimal strings. */
export function toSettingsBody(changes) {
  const apiName = (group, key) => Object.entries(SETTINGS[group]).find(([, name]) => name === key)?.[0]
  const toValue = (key, value) => {
    if (MONEY_SETTINGS.includes(key)) return value.toFixed(2)
    // Phase 11 §4: like the API answers them ("1.00", "0.0100").
    if (key === 'earnRate') return value.toFixed(2)
    if (key === 'pointValue') return value.toFixed(4)
    if (key === 'taxRates') return value.map((rate) => ({ country: rate.country, rate: rate.rate.toFixed(2) }))
    return value
  }
  return Object.fromEntries(
    Object.entries(changes).map(([group, values]) => [group, Object.fromEntries(Object.entries(values).map(([key, value]) => [apiName(group, key), toValue(key, value)]))]),
  )
}
const settingsFieldName = (field) => {
  const [group, key, ...rest] = field.split('.')
  const name = SETTINGS[group]?.[key]
  return name ? [group, name, ...rest].join('.') : camelPath(field)
}

// ---- the calls ----

const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

export const laravelSystemData = {
  async listAdmins(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/admins?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'admins', adminUser, filters))
  },
  async getAdmin(token, id, request) {
    return answer(await call(`/admins/${id}`, token, request), [200], (data) => ({ ...adminUser(data.data), live: true }))
  },
  async createAdmin(token, values, request) {
    return answer(await call('/admins', token, request, { method: 'POST', body: toBody(values, ADMIN_FIELDS) }), [200, 201], (data) => ({ admin: adminUser(data.data), live: true }))
  },
  async updateAdmin(token, id, values, request) {
    return answer(await call(`/admins/${id}`, token, request, { method: 'PATCH', body: toBody(values, ADMIN_FIELDS) }), [200], (data) => ({ admin: adminUser(data.data), live: true }))
  },
  async resetAdminPassword(token, id, { password }, request) {
    const result = await call(`/admins/${id}/reset-password`, token, request, { method: 'POST', body: { password, password_confirmation: password } })
    return answer(result, [200, 204], (data) => ({ ok: true, message: data?.message ?? 'Password changed. They were signed out everywhere.' }))
  },

  async listRoles(token, request) {
    return answer(await call('/roles', token, request), [200], (data) => ({ roles: listOf(data).map(adminRole), live: true }))
  },
  async createRole(token, values, request) {
    return answer(await call('/roles', token, request, { method: 'POST', body: toBody(values, ROLE_FIELDS) }), [200, 201], (data) => ({ role: adminRole(data.data), live: true }))
  },
  async updateRole(token, id, values, request) {
    return answer(await call(`/roles/${id}`, token, request, { method: 'PATCH', body: toBody(values, ROLE_FIELDS) }), [200], (data) => ({ role: adminRole(data.data), live: true }))
  },
  async deleteRole(token, id, request) {
    return answer(await call(`/roles/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },
  async permissions(token, request) {
    return answer(await call('/permissions', token, request), [200], (data) => ({ groups: permissionGroups(data), live: true }))
  },

  async audit(token, filters, request) {
    const { adminId, subjectType, ...rest } = filters
    return answer(await call(`/audit?${listParams({ ...rest, admin_id: adminId, subject_type: subjectType })}`, token, request), [200], (data) => paged(data, 'entries', auditEntry, filters))
  },

  async listPages(token, filters, request) {
    const { q, ...rest } = filters
    return answer(await call(`/pages?${listParams({ ...rest, search: q })}`, token, request), [200], (data) => paged(data, 'pages', contentPage, filters))
  },
  async getPage(token, id, request) {
    return answer(await call(`/pages/${id}`, token, request), [200], (data) => ({ ...contentPage(data.data), live: true }))
  },
  async createPage(token, values, request) {
    return answer(await call('/pages', token, request, { method: 'POST', body: toBody(values, PAGE_FIELDS) }), [200, 201], (data) => ({ page: contentPage(data.data), live: true }))
  },
  async updatePage(token, id, values, request) {
    return answer(await call(`/pages/${id}`, token, request, { method: 'PATCH', body: toBody(values, PAGE_FIELDS) }), [200], (data) => ({ page: contentPage(data.data), live: true }))
  },
  async deletePage(token, id, request) {
    return answer(await call(`/pages/${id}`, token, request, { method: 'DELETE' }), [200, 204], () => ({ id: Number(id), deleted: true, live: true }))
  },

  async getHome(token, request) {
    return answer(await call('/home', token, request), [200], (data) => ({ ...homeContent(data.data), live: true }))
  },
  async updateHome(token, home, request) {
    const result = await call('/home', token, request, { method: 'PUT', body: toHomeBody(home) })
    return answer(result, [200], (data) => ({ home: homeContent(data.data), live: true }))
  },

  async report(token, name, params, request) {
    const result = await call(`/reports/${name}?${params}`, token, request)
    return answer(result, [200], (data) => ({ ...REPORT_MAPS[name](data?.data), ...(data?.meta && { range: rangeOf(data.meta) }), live: true }))
  },

  async getSettings(token, request) {
    return answer(await call('/settings', token, request), [200], (data) => ({ ...storeSettings(data.data), live: true }))
  },
  async updateSettings(token, changes, request) {
    const result = await call('/settings', token, request, { method: 'PATCH', body: toSettingsBody(changes) })
    if (result.status !== 200) return failed(result, settingsFieldName)
    return { ok: true, status: 200, data: { ...storeSettings(result.data?.data), live: true } }
  },
}

const rangeOf = (meta) => ({ ...pick(meta, ['from', 'to']), ...(meta.group_by && { groupBy: meta.group_by }) })
