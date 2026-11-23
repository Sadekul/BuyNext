import { laravel, laravelMultipart } from '../http.js'
import { camelPath } from './laravel.js'
import { failed } from './adminSystem.js'
// Phase 13: the Bangla texts of categories, option names and values.
import { banglaOf, optionNameBangla, optionValueBangla, toOptionBody, withBanglaBody } from './adminPhase13.js'

/*
 * Phase 5 of the admin (docs/backend/PHASE5_CONTRACT.md) from BuyNest's
 * Laravel admin API: the category tree, product images, options and
 * variants, mass actions, CSV import, and review moderation.
 *
 * Same conventions as shop/admin.js and shop/adminSystem.js: snake_case in,
 * camelCase out, money as numbers for the browser and 2-decimal strings for
 * the API, only listed fields copied either way. A 403 `permission_denied`
 * keeps its code and permission.
 *
 * Each function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const money = (value) => (value === null || value === undefined || value === '' ? null : Number(value))
const text = (value) => (typeof value === 'string' ? value : '')
const list = (value) => (Array.isArray(value) ? value : [])

// Laravel field names → the admin forms' names (anything else: camelCase path).
const FIELD_NAMES = {
  parent_id: 'parentId',
  is_active: 'isActive',
  image_url: 'imageUrl',
  meta_title: 'metaTitle',
  meta_description: 'metaDescription',
  stock_quantity: 'stock',
  option_value_ids: 'optionValueIds',
  dry_run: 'dryRun',
  'images.*': 'images',
}
const fieldName = (field) => FIELD_NAMES[field] ?? (/^images\.\d+$/.test(field) ? 'images' : camelPath(field))
const refused = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : refused(result))
const listOf = (data) => list(data?.data)

// ---- categories ----

/** One category of the tree → the admin's category (children left out; see flattenCategories). */
export function adminCategory(raw, depth = 0) {
  return {
    id: raw.id,
    name: text(raw.name),
    slug: text(raw.slug),
    parentId: raw.parent_id ?? null,
    position: raw.position ?? 0,
    isActive: raw.is_active !== false,
    imageUrl: raw.image_url ?? null,
    description: raw.description ?? '',
    metaTitle: raw.meta_title ?? '',
    metaDescription: raw.meta_description ?? '',
    productCount: raw.product_count ?? raw.products_count ?? 0,
    childCount: list(raw.children).length,
    depth,
    // Phase 13: bn: { name, description, metaTitle, metaDescription } ('' = the English text is shown).
    ...banglaOf(raw, 'category'),
  }
}

/**
 * GET /categories → a flat list in tree order (each parent before its
 * children), with `depth` for indenting. The product filter and form keep
 * reading [{ id, slug, name }] as before; the categories page indents by depth.
 * A flat answer (no `children`, older API) is ordered by parent too.
 */
export function flattenCategories(raw) {
  const roots = list(raw)
  const nested = roots.some((category) => Array.isArray(category.children))
  const out = []
  const walk = (categories, depth) => {
    for (const category of categories) {
      out.push(adminCategory(category, depth))
      walk(list(category.children), depth + 1)
    }
  }
  if (nested) {
    walk(roots, 0)
    return out
  }
  // Flat: build the tree from parent_id (unknown parents count as top level).
  const ids = new Set(roots.map((category) => category.id))
  const byParent = new Map()
  for (const category of roots) {
    const parent = ids.has(category.parent_id) ? category.parent_id : null
    byParent.set(parent, [...(byParent.get(parent) ?? []), category])
  }
  const add = (parent, depth) => {
    for (const category of byParent.get(parent) ?? []) {
      out.push({ ...adminCategory(category, depth), childCount: (byParent.get(category.id) ?? []).length })
      if (depth < 10) add(category.id, depth + 1)
    }
  }
  add(null, 0)
  return out
}

const CATEGORY_FIELDS = {
  name: 'name',
  slug: 'slug',
  parentId: 'parent_id',
  position: 'position',
  isActive: 'is_active',
  imageUrl: 'image_url',
  description: 'description',
  metaTitle: 'meta_title',
  metaDescription: 'meta_description',
}
const toBody = (values, fields) => Object.fromEntries(Object.entries(values).filter(([field]) => fields[field]).map(([field, value]) => [fields[field], value]))

// ---- products: images, options, variants ----

/*
 * Phase 9 §2: resized copies, { "320": url, "960": url } (maximum widths;
 * {} when there are none). Only the two known widths and site paths or http(s)
 * addresses are kept.
 */
export function imageVariants(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(['320', '960'].filter((width) => typeof raw[width] === 'string' && /^(\/(?!\/)|https?:\/\/)\S+$/.test(raw[width])).map((width) => [width, raw[width]]))
}

/** { id, url, alt, position, isUpload, variants? } (isUpload false: an imported external address; variants: phase 9 answers). */
export function adminImage(raw) {
  return { id: raw.id ?? null, url: text(raw.url), alt: text(raw.alt), position: raw.position ?? 0, isUpload: raw.is_upload !== false, ...(raw.variants !== undefined && { variants: imageVariants(raw.variants) }) }
}
const images = (raw) => list(raw).map(adminImage).sort((a, b) => a.position - b.position)

// Phase 13: only answers that have the Bangla names carry them (older answers: nothing).
const hasBangla = (raw) => raw.name_bn !== undefined || raw.value_bn !== undefined || raw.translations !== undefined

export function adminOption(raw) {
  return {
    id: raw.id ?? null,
    name: text(raw.name),
    // Phase 13: the Bangla name of the option and of each value ('' = the English one is shown).
    ...(hasBangla(raw) && { nameBn: optionNameBangla(raw) }),
    position: raw.position ?? 0,
    values: list(raw.values)
      .map((value) =>
        typeof value === 'string'
          ? { id: null, value, position: 0 }
          : { id: value.id ?? null, value: text(value.value), ...(hasBangla(value) && { valueBn: optionValueBangla(value) }), position: value.position ?? 0 },
      )
      .sort((a, b) => a.position - b.position),
  }
}

export function adminVariant(raw) {
  return {
    id: raw.id,
    sku: text(raw.sku),
    optionValueIds: list(raw.option_value_ids).filter(Number.isInteger),
    label: raw.label ?? raw.variant_label ?? null,
    price: money(raw.price),
    effectivePrice: money(raw.effective_price),
    finalPrice: money(raw.final_price),
    stock: raw.stock_quantity ?? 0,
    isActive: raw.is_active === true,
    // false: one of its option values was removed; it stays inactive.
    isCurrent: raw.is_current !== false,
  }
}

/** The phase 5 parts of an AdminProductResource (added to the admin's product by shop/admin.js). */
export function productParts(raw) {
  const variants = list(raw.variants).map(adminVariant)
  return {
    imageList: images(raw.images),
    options: list(raw.options).map(adminOption).sort((a, b) => a.position - b.position),
    variants,
    hasVariants: raw.has_variants ?? variants.length > 0,
  }
}

/** An answer that may be the product, a list of images, or { images }. */
const imagesFrom = (data) => images(Array.isArray(data?.data) ? data.data : (data?.data?.images ?? []))

const VARIANT_FIELDS = { sku: 'sku', price: 'price', stock: 'stock_quantity', isActive: 'is_active' }
const toVariantBody = (values) => {
  const body = toBody(values, VARIANT_FIELDS)
  if (typeof values.price === 'number') body.price = values.price.toFixed(2)
  return body
}

// ---- mass actions and import ----

/** Bulk answer: { updated, skipped: [{ id, reason }] }. */
export function bulkResult(raw) {
  return {
    updated: raw?.updated ?? 0,
    skipped: list(raw?.skipped).map((entry) => ({ id: entry.id ?? null, name: entry.name ?? null, reason: text(entry.reason) })),
  }
}

/** Import report: { dryRun, rows, created, updated, unchanged, errors: [{ row, column, message }], warnings (phase 11: same shape, nothing blocked) }. */
export function importReport(raw) {
  return {
    dryRun: raw?.dry_run !== false,
    rows: raw?.rows ?? 0,
    created: raw?.created ?? 0,
    updated: raw?.updated ?? 0,
    unchanged: raw?.unchanged ?? 0,
    errors: list(raw?.errors).map((entry) => ({ row: entry.row ?? null, column: entry.column ?? null, message: text(entry.message) })),
    warnings: list(raw?.warnings).map((entry) => ({ row: entry.row ?? null, column: entry.column ?? null, message: text(entry.message) })),
  }
}

// ---- reviews ----

export function adminReview(raw) {
  const product = raw.product && typeof raw.product === 'object' ? raw.product : {}
  const customer = raw.customer && typeof raw.customer === 'object' ? raw.customer : {}
  return {
    id: raw.id,
    productId: raw.product_id ?? product.id ?? null,
    productName: text(product.name ?? raw.product_name),
    productSku: product.sku ?? null,
    productThumbnail: product.thumbnail_url ?? null,
    authorName: text(raw.author_name ?? customer.name),
    authorEmail: raw.author_email ?? customer.email ?? null,
    rating: raw.rating ?? 0,
    title: raw.title ?? '',
    comment: text(raw.comment),
    status: raw.status ?? 'pending',
    verifiedPurchase: raw.verified_purchase === true,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}

/** ?page&per_page from the admin's limit/skip, plus any filters that have a value. */
function listParams({ limit = 20, skip = 0, ...filters }) {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

// ---- the calls ----

const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })
const done = (id) => () => ({ id: Number(id), deleted: true, live: true })

export const laravelCatalogData = {
  async categories(token, request) {
    return answer(await call('/categories', token, request), [200], (data) => flattenCategories(data?.data))
  },
  async createCategory(token, values, request) {
    return answer(await call('/categories', token, request, { method: 'POST', body: withBanglaBody(toBody(values, CATEGORY_FIELDS), values, 'category') }), [200, 201], (data) => ({ category: adminCategory(data?.data ?? {}), live: true }))
  },
  async updateCategory(token, id, values, request) {
    return answer(await call(`/categories/${id}`, token, request, { method: 'PATCH', body: withBanglaBody(toBody(values, CATEGORY_FIELDS), values, 'category') }), [200], (data) => ({ category: adminCategory(data?.data ?? {}), live: true }))
  },
  async deleteCategory(token, id, request) {
    return answer(await call(`/categories/${id}`, token, request, { method: 'DELETE' }), [200, 204], done(id))
  },
  async reorderCategories(token, { parentId, ids }, request) {
    const result = await call('/categories/reorder', token, request, { method: 'POST', body: { parent_id: parentId, ids } })
    return answer(result, [200, 204], (data) => ({ ok: true, categories: flattenCategories(data?.data), live: true }))
  },

  async uploadImages(token, id, { contentType, bytes }, request) {
    const result = await laravelMultipart(`/api/admin/v1/products/${id}/images`, { token, request, contentType, bytes })
    return answer(result, [200, 201], (data) => ({ images: imagesFrom(data), live: true }))
  },
  // Every image answer is the product's whole gallery, in order.
  async updateImage(token, id, imageId, { alt }, request) {
    return answer(await call(`/products/${id}/images/${imageId}`, token, request, { method: 'PATCH', body: { alt } }), [200], (data) => ({ images: imagesFrom(data), live: true }))
  },
  async deleteImage(token, id, imageId, request) {
    return answer(await call(`/products/${id}/images/${imageId}`, token, request, { method: 'DELETE' }), [200, 204], (data) => ({ id: Number(imageId), deleted: true, images: imagesFrom(data), live: true }))
  },
  async reorderImages(token, id, { ids }, request) {
    return answer(await call(`/products/${id}/images/reorder`, token, request, { method: 'POST', body: { ids } }), [200, 204], (data) => ({ images: imagesFrom(data), live: true }))
  },

  async saveOptions(token, id, { options }, request) {
    const result = await call(`/products/${id}/options`, token, request, { method: 'PUT', body: { options: options.map(toOptionBody) } })
    return answer(result, [200], (data) => ({ ...productParts(data?.data ?? {}), live: true }))
  },
  async generateVariants(token, id, request) {
    const result = await call(`/products/${id}/variants/generate`, token, request, { method: 'POST', body: {} })
    return answer(result, [200, 201], (data) => ({ ...productParts(data?.data ?? {}), ...(Number.isInteger(data?.meta?.created) && { created: data.meta.created }), live: true }))
  },
  /** The answer is the whole product: its options and variants as now saved. */
  async updateVariant(token, id, variantId, values, request) {
    const result = await call(`/products/${id}/variants/${variantId}`, token, request, { method: 'PATCH', body: toVariantBody(values) })
    return answer(result, [200], (data) => ({ ...productParts(data?.data ?? {}), live: true }))
  },

  async bulk(token, { ids, action, value }, request) {
    const result = await call('/products/bulk', token, request, { method: 'POST', body: { ids, action, ...(value !== undefined && { value }) } })
    return answer(result, [200], (data) => ({ ...bulkResult(data?.data), live: true }))
  },

  async importProducts(token, { dryRun, contentType, bytes }, request) {
    const result = await laravelMultipart(`/api/admin/v1/products/import?dry_run=${dryRun ? 1 : 0}`, { token, request, contentType, bytes })
    if ([200, 201].includes(result.status)) return { ok: true, status: 200, data: { ...importReport(result.data?.data), live: true } }
    // Rows with errors may come back as a 422 with the report: keep it.
    const failure = refused(result)
    if (result.data?.data && typeof result.data.data === 'object' && 'rows' in result.data.data) failure.body.report = importReport(result.data.data)
    return failure
  },

  async listReviews(token, filters, request) {
    const { q, productId, ...rest } = filters
    const result = await call(`/reviews?${listParams({ ...rest, product_id: productId, search: q })}`, token, request)
    return answer(result, [200], (data) => ({
      reviews: listOf(data).map(adminReview),
      total: data?.meta?.total ?? listOf(data).length,
      // How many reviews have each status (all products), for the filter.
      counts: Object.fromEntries(['pending', 'approved', 'rejected'].map((status) => [status, Number(data?.meta?.counts?.[status] ?? 0)])),
      limit: filters.limit,
      skip: filters.skip,
      live: true,
    }))
  },
  async updateReview(token, id, { status }, request) {
    return answer(await call(`/reviews/${id}`, token, request, { method: 'PATCH', body: { status } }), [200], (data) => ({ review: adminReview(data?.data ?? {}), live: true }))
  },
  async bulkReviews(token, { ids, status }, request) {
    return answer(await call('/reviews/bulk', token, request, { method: 'POST', body: { ids, status } }), [200], (data) => ({ ...bulkResult(data?.data), live: true }))
  },
  async deleteReview(token, id, request) {
    return answer(await call(`/reviews/${id}`, token, request, { method: 'DELETE' }), [200, 204], done(id))
  },
}
