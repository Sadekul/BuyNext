import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LuArrowDown, LuArrowUp, LuSearch, LuX } from 'react-icons/lu'
import { adminKeys, getProducts } from '../api/admin'
import { LINK_TYPES, MAX_LINKS, moved } from '../utils/productLinks'
import { permissionLabel } from '../utils/permissions'
import { formatMoney } from '../utils/format'
import { Loading } from './States'

/**
 * Phase 11 §3 (Magento's product links): related products, up-sells and
 * cross-sells, each an ordered list of at most 20 products chosen with a
 * search by name or SKU. Moved and removed with buttons; focus stays on the
 * moved product's button, and every change is announced. Saved with the product.
 * `lists` = { related: [{ id, name, sku, image, status }], upsell: [...], crosssell: [...] }.
 */
function ProductLinks({ productId, lists, onChange, errors = {}, disabled = false }) {
  const [announcement, setAnnouncement] = useState('')
  return (
    <fieldset className="form__fieldset product-extra">
      <legend>Related products, up-sells and cross-sells</legend>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {LINK_TYPES.map((type) => (
        <LinkList
          key={type.id}
          type={type}
          productId={productId === undefined ? null : Number(productId)}
          list={lists[type.id] ?? []}
          error={errors[type.id]}
          disabled={disabled}
          onChange={(next) => onChange({ ...lists, [type.id]: next })}
          announce={setAnnouncement}
        />
      ))}
      {errors.general && (
        <p className="field__error" role="alert">
          {errors.general}
        </p>
      )}
    </fieldset>
  )
}

function LinkList({ type, productId, list, error, disabled, onChange, announce }) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const refs = useRef(new Map())
  const searchRef = useRef(null)
  const hintId = useId()
  const errorId = useId()
  const searchId = useId()
  const results = useQuery({
    queryKey: adminKeys.products({ q: query, limit: 8, picker: 'links' }),
    queryFn: ({ signal }) => getProducts({ q: query, limit: 8 }, { signal }),
    enabled: query !== '',
  })
  const full = list.length >= MAX_LINKS
  const chosen = new Set(list.map((product) => product.id))
  const focusLater = (key) => requestAnimationFrame(() => (key ? refs.current.get(key) : searchRef.current)?.focus())
  const lower = type.label.toLowerCase()

  function add(product) {
    if (full || chosen.has(product.id) || product.id === productId) return
    onChange([...list, { id: product.id, name: product.title, sku: product.sku ?? null, image: product.thumbnail ?? null, status: product.status ?? null }])
    announce(`${product.title} added to ${lower} (${list.length + 1} of ${MAX_LINKS}).`)
  }
  function remove(index) {
    const next = list.filter((_, at) => at !== index)
    onChange(next)
    announce(`${list[index].name} removed from ${lower}.`)
    const neighbour = next[index] ?? next[index - 1]
    focusLater(neighbour ? `${neighbour.id}-remove` : null)
  }
  function move(index, step) {
    const product = list[index]
    const target = index + step
    onChange(moved(list, index, step))
    announce(`${product.name} moved to position ${target + 1} of ${list.length} in ${lower}.`)
    const atEnd = step < 0 ? target === 0 : target === list.length - 1
    focusLater(`${product.id}-${(step < 0) !== atEnd ? 'up' : 'down'}`)
  }
  const search = () => setQuery(draft.trim())

  return (
    <fieldset className="scope-list link-list" aria-describedby={[hintId, error && errorId].filter(Boolean).join(' ')}>
      <legend>{type.label}</legend>
      <p id={hintId} className="field__hint">
        {type.hint} {list.length === 0 ? 'None chosen.' : `${list.length} of ${MAX_LINKS}.`}
      </p>
      {list.length > 0 && (
        <ol className="picker-list link-list__items">
          {list.map((product, index) => (
            <li key={product.id}>
              <span className="link-list__product">
                {product.image ? <img src={product.image} alt="" width="32" height="32" loading="lazy" /> : <span className="link-list__image" aria-hidden="true" />}
                <span>
                  {product.name || `Product #${product.id}`}
                  <small className="muted">
                    {' '}
                    {product.sku ? `SKU ${product.sku}` : `#${product.id}`}
                    {product.status && product.status !== 'active' && ` · ${product.status} (not shown in the store)`}
                  </small>
                </span>
              </span>
              {!disabled && (
                <span className="picker-list__tools">
                  <button
                    type="button"
                    ref={(node) => refs.current.set(`${product.id}-up`, node)}
                    className="icon-button"
                    aria-label={`Move ${product.name} up in ${lower}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <LuArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    ref={(node) => refs.current.set(`${product.id}-down`, node)}
                    className="icon-button"
                    aria-label={`Move ${product.name} down in ${lower}`}
                    disabled={index === list.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <LuArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    ref={(node) => refs.current.set(`${product.id}-remove`, node)}
                    className="icon-button icon-button--danger"
                    aria-label={`Remove ${product.name} from ${lower}`}
                    onClick={() => remove(index)}
                  >
                    <LuX aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {!disabled && (
        <>
          {/* Not a nested <form>: Enter in the search box searches instead of saving the product. */}
          <div className="toolbar" role="search" aria-label={`Find ${lower}`}>
            <label className="toolbar__search" htmlFor={searchId}>
              <span className="visually-hidden">Search products to add to {lower}</span>
              <input
                id={searchId}
                ref={searchRef}
                type="search"
                value={draft}
                placeholder="Search by name or SKU"
                disabled={full}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  search()
                }}
              />
            </label>
            <button type="button" className="btn btn--outline" aria-label={`Search ${lower}`} disabled={full} onClick={search}>
              <LuSearch aria-hidden="true" /> Search
            </button>
          </div>
          {full && <p className="field__hint">The list is full ({MAX_LINKS} products): remove one to add another.</p>}
          <div aria-live="polite">
            {results.isFetching && <Loading label="Searching…" />}
            {results.error && (
              <p className="muted">
                {results.error.code === 'permission_denied' && results.error.permission
                  ? `Your role can't list products (${permissionLabel(results.error.permission)}).`
                  : "The products couldn't be loaded."}
              </p>
            )}
            {results.data && !results.isFetching && results.data.products.length === 0 && <p className="muted">No products match “{query}”.</p>}
            {results.data && results.data.products.length > 0 && !full && (
              <ul className="picker-list" aria-label={`Search results for ${lower}`}>
                {results.data.products.map((product) => {
                  const self = product.id === productId
                  const added = chosen.has(product.id)
                  return (
                    <li key={product.id}>
                      <span>
                        {product.title}{' '}
                        <small className="muted">
                          {product.sku ? `SKU ${product.sku}` : `#${product.id}`} · {formatMoney(product.price)}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        disabled={added || self}
                        onClick={() => add(product)}
                        aria-label={self ? `${product.title} is this product` : added ? `${product.title} is already in ${lower}` : `Add ${product.title} to ${lower}`}
                      >
                        {self ? 'This product' : added ? 'Added' : 'Add'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </fieldset>
  )
}

export default ProductLinks
