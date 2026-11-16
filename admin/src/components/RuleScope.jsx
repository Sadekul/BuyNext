import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LuSearch, LuX } from 'react-icons/lu'
import { adminKeys, getCategories, getCustomerGroups, getProduct, getProducts } from '../api/admin'
import { permissionLabel } from '../utils/permissions'
import { withPaths } from '../utils/categories'
import { formatMoney } from '../utils/format'
import { Loading } from './States'

/*
 * Who and what a marketing rule applies to (catalog price rules and cart
 * price rules): customer groups, categories, and products, as accessible
 * checkbox lists and a product search. Each list is a <fieldset> whose
 * legend names it; an empty choice means "all" (the hint says so).
 *
 * The lists come from other screens' endpoints (customer groups need
 * customers.view, categories and products need products.view). A role
 * without them still sees and keeps the rule's current choice, by id.
 */

const toggle = (list, id, on) => (on ? [...list, id] : list.filter((item) => item !== id))

function Unavailable({ error, ids, noun }) {
  const why = error?.code === 'permission_denied' && error.permission ? `Your role can't list ${noun} (${permissionLabel(error.permission)}).` : `The ${noun} couldn't be loaded.`
  return (
    <p className="muted">
      {why} {ids.length > 0 ? `This rule keeps its current choice (${ids.map((id) => `#${id}`).join(', ')}).` : ''}
    </p>
  )
}

function Group({ legend, hint, error, children }) {
  const hintId = useId()
  const errorId = useId()
  return (
    <fieldset className="scope-list" aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined}>
      <legend>{legend}</legend>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** Customer groups as checkboxes. */
export function GroupChecklist({ legend = 'Customer groups', hint = 'None checked: everyone, including guests.', selected, onChange, error, disabled = false }) {
  const groups = useQuery({ queryKey: adminKeys.customerGroups, queryFn: ({ signal }) => getCustomerGroups({ signal }) })
  return (
    <Group legend={legend} hint={hint} error={error}>
      {groups.isPending && <Loading label="Loading customer groups…" />}
      {groups.error && <Unavailable error={groups.error} ids={selected} noun="customer groups" />}
      {groups.data && (
        <ul className="scope-list__items">
          {groups.data.groups.map((group) => (
            <li key={group.id}>
              <label className="checkbox">
                <input type="checkbox" disabled={disabled} checked={selected.includes(group.id)} onChange={(event) => onChange(toggle(selected, group.id, event.target.checked))} />
                {group.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Group>
  )
}

/** Categories as checkboxes, indented by depth ("Beauty › Lipstick" for screen readers). */
export function CategoryChecklist({ legend = 'Categories', hint = 'A category includes its subcategories.', selected, onChange, error, disabled = false }) {
  const categories = useQuery({ queryKey: adminKeys.categories, queryFn: ({ signal }) => getCategories({ signal }) })
  const list = Array.isArray(categories.data) ? withPaths(categories.data).filter((category) => category.id !== undefined) : []
  return (
    <Group legend={legend} hint={hint} error={error}>
      {categories.isPending && <Loading label="Loading categories…" />}
      {categories.error && <Unavailable error={categories.error} ids={selected} noun="categories" />}
      {categories.data && (
        <ul className="scope-list__items scope-list__items--scroll">
          {list.map((category) => (
            <li key={category.id} style={{ paddingInlineStart: `${(category.depth ?? 0) * 1.25}rem` }}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.includes(category.id)}
                  onChange={(event) => onChange(toggle(selected, category.id, event.target.checked))}
                  aria-label={category.path}
                />
                <span aria-hidden="true">{category.name}</span>
                {category.isActive === false && <small className="muted"> (hidden)</small>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Group>
  )
}

const NAMED = 25 // the chosen products whose names are looked up; the rest show by id

function ProductName({ id, known }) {
  const product = useQuery({ queryKey: adminKeys.product(id), queryFn: ({ signal }) => getProduct(id, { signal }), enabled: !known, staleTime: 300_000 })
  return known ?? product.data?.title ?? `Product #${id}`
}

/**
 * Chosen products (removable) and a search to add more. Not a nested <form>:
 * Enter in the search box searches instead of saving the rule.
 */
export function ProductPicker({ legend = 'Products', hint, selected, onChange, error, disabled = false, announce }) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [names, setNames] = useState({})
  const results = useQuery({ queryKey: adminKeys.products({ q: query, limit: 8, picker: true }), queryFn: ({ signal }) => getProducts({ q: query, limit: 8 }, { signal }), enabled: query !== '' })
  const searchId = useId()

  function add(product) {
    if (selected.includes(product.id)) return
    setNames((current) => ({ ...current, [product.id]: product.title }))
    onChange([...selected, product.id])
    announce?.(`${product.title} added.`)
  }
  function remove(id) {
    onChange(selected.filter((item) => item !== id))
    announce?.(`${names[id] ?? `Product #${id}`} removed.`)
  }

  return (
    <Group legend={legend} hint={hint ?? `${selected.length === 0 ? 'None chosen.' : `${selected.length} chosen.`}`} error={error}>
      {selected.length > 0 && (
        <ul className="picker-list">
          {selected.map((id, index) => (
            <li key={id}>
              <span>
                {index < NAMED || names[id] ? <ProductName id={id} known={names[id]} /> : `Product #${id}`} <small className="muted">#{id}</small>
              </span>
              {!disabled && (
                <button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${names[id] ?? `product #${id}`}`} onClick={() => remove(id)}>
                  <LuX aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <>
          <div className="toolbar" role="search" aria-label={`Find products for ${legend.toLowerCase()}`}>
            <label className="toolbar__search" htmlFor={searchId}>
              <span className="visually-hidden">Search products to add</span>
              <input
                id={searchId}
                type="search"
                value={draft}
                placeholder="Search products by name"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  setQuery(draft.trim())
                }}
              />
            </label>
            <button type="button" className="btn btn--outline" onClick={() => setQuery(draft.trim())}>
              <LuSearch aria-hidden="true" /> Search
            </button>
          </div>
          <div aria-live="polite">
            {results.isFetching && <Loading label="Searching…" />}
            {results.error && <Unavailable error={results.error} ids={[]} noun="products" />}
            {results.data && !results.isFetching && results.data.products.length === 0 && <p className="muted">No products match “{query}”.</p>}
            {results.data && results.data.products.length > 0 && (
              <ul className="picker-list">
                {results.data.products.map((product) => (
                  <li key={product.id}>
                    <span>
                      {product.title} <small className="muted">#{product.id} · {formatMoney(product.price)}</small>
                    </span>
                    <button type="button" className="btn btn--outline btn--sm" disabled={selected.includes(product.id)} onClick={() => add(product)} aria-label={`Add ${product.title}`}>
                      {selected.includes(product.id) ? 'Added' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Group>
  )
}
