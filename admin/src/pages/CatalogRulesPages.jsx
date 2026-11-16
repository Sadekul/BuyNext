import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuPencil, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { createCatalogRule, deleteCatalogRule, getCatalogRule, getCatalogRulePreview, getCatalogRules, marketingKeys, updateCatalogRule } from '../api/marketing'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { CategoryChecklist, GroupChecklist, ProductPicker } from '../components/RuleScope'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { toLocalInput } from '../utils/couponSchema'
import { formatCount, formatDate, formatMoney } from '../utils/format'
import { RULE_STATUSES, describeRuleAction, describeScope, ruleStatus, useNotice } from '../utils/marketing'

/*
 * Marketing → Catalog price rules (phase 7): automatic sales on catalog
 * prices, like Magento's. Reading needs coupons.view; adding, changing, and
 * deleting need price_rules.manage. The server applies the rules (lowest
 * price wins, priority order, "stop further rules", never below $0.01).
 */

const LIMIT = 20

export function CatalogRulesPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [pending, setPending] = useState(null)
  const { notice, setNotice, ref } = useNotice()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const manage = can('price_rules.manage')
  const query = { q, status, skip, limit: LIMIT }
  const rules = useQuery({ queryKey: marketingKeys.rules(query), queryFn: ({ signal }) => getCatalogRules(query, { signal }), placeholderData: keepPreviousData })

  const remove = useMutation({
    mutationFn: (rule) => deleteCatalogRule(rule.id),
    onSuccess: (_, rule) => {
      setPending(null)
      queryClient.invalidateQueries({ queryKey: ['catalog-rules'] })
      setNotice({ tone: 'success', text: `“${rule.name}” deleted. Prices go back to normal right away.` })
    },
    onError: (error) => {
      setPending(null)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || status)
  return (
    <>
      <title>Catalog price rules | BuyNest Admin</title>
      <PageHeader
        title="Catalog price rules"
        description={rules.data ? `${formatCount(rules.data.total)} ${filtered ? 'matching rules' : 'rules'} · automatic sale prices, applied in priority order` : 'Automatic sale prices in the catalog'}
        actions={
          manage && (
            <Link to="/catalog-rules/new" className="btn btn--primary">
              <LuPlus aria-hidden="true" /> Add rule
            </Link>
          )
        }
      />
      <Notice notice={notice} noticeRef={ref} />

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="rule-search" className="visually-hidden">
            Search price rules
          </label>
          <input id="rule-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Rule name" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All rules</option>
            {Object.entries(RULE_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rules.isPending && <Loading label="Loading price rules…" />}
      {rules.error && <ErrorState error={rules.error} onRetry={rules.refetch} />}
      {rules.data && rules.data.rules.length === 0 && <Empty>{filtered ? 'No rules match.' : 'No catalog price rules yet.'}</Empty>}
      {rules.data && rules.data.rules.length > 0 && (
        <div className="table-wrap" aria-busy={rules.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Catalog price rules, in priority order</caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Discount</th>
                <th scope="col">Applies to</th>
                <th scope="col" className="num">
                  Priority
                </th>
                <th scope="col">Dates</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.data.rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <Link to={`/catalog-rules/${rule.id}`}>
                      <strong>{rule.name}</strong>
                    </Link>
                    {rule.stopFurther && (
                      <>
                        <br />
                        <small className="muted">Stops later rules</small>
                      </>
                    )}
                  </td>
                  <td>{describeRuleAction(rule)}</td>
                  <td className="muted">{describeScope(rule)}</td>
                  <td className="num">{rule.priority}</td>
                  <td className="muted">{rule.startsAt || rule.endsAt ? `${formatDate(rule.startsAt, 'Now')} – ${formatDate(rule.endsAt, 'no end')}` : 'Always'}</td>
                  <td>
                    <StatusBadge {...ruleStatus(rule.status)} />
                  </td>
                  <td className="table__actions">
                    {manage && (
                      <>
                        <Link to={`/catalog-rules/${rule.id}`} className="icon-button" aria-label={`Edit ${rule.name}`}>
                          <LuPencil aria-hidden="true" />
                        </Link>
                        <button type="button" className="icon-button icon-button--danger" onClick={() => setPending(rule)} aria-label={`Delete ${rule.name}`}>
                          <LuTrash2 aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={rules.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      <ConfirmDialog
        isOpen={pending !== null}
        title={`Delete “${pending?.name}”?`}
        message="Its sale prices end at once. Orders already placed keep the prices they were charged."
        confirmLabel="Delete rule"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </>
  )
}

/** /catalog-rules/new and /catalog-rules/:ruleId. */
export function CatalogRuleFormPage() {
  const { ruleId } = useParams()
  const isNew = ruleId === undefined
  const rule = useQuery({ queryKey: marketingKeys.rule(ruleId), queryFn: ({ signal }) => getCatalogRule(ruleId, { signal }), enabled: !isNew })
  if (!isNew && rule.isPending) return <Loading label="Loading the rule…" />
  if (!isNew && rule.error) return <ErrorState error={rule.error} onRetry={rule.refetch} />
  // Remounted per rule, so the form starts from that rule's saved values.
  return <CatalogRuleForm key={ruleId ?? 'new'} saved={isNew ? null : rule.data} />
}

const EMPTY_RULE = { name: '', description: '', isActive: true, startsAt: '', endsAt: '', action: 'percent', amount: '', priority: '0', stopFurther: false, customerGroupIds: [], categoryIds: [], productIds: [] }
const toForm = (rule) => ({
  name: rule.name,
  description: rule.description ?? '',
  isActive: rule.isActive,
  startsAt: toLocalInput(rule.startsAt),
  endsAt: toLocalInput(rule.endsAt),
  action: rule.action,
  amount: String(rule.amount ?? ''),
  priority: String(rule.priority ?? 0),
  stopFurther: rule.stopFurther,
  customerGroupIds: rule.customerGroupIds ?? [],
  categoryIds: rule.categoryIds ?? [],
  productIds: rule.productIds ?? [],
})
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

/** The browser's checks (the server checks again; its 422 messages land on the same fields). */
function checkRule(values) {
  const errors = {}
  const amount = Number(values.amount)
  if (!values.name.trim() || values.name.trim().length > 120) errors.name = ['Enter a name of up to 120 characters.']
  if (values.description.length > 500) errors.description = ['Keep the description under 500 characters.']
  if (values.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0 || !hasCents(amount)) errors.amount = ['Enter an amount above 0 with at most 2 decimals.']
  else if (values.action === 'percent' && amount > 100) errors.amount = ['Enter a percentage from 0.01 to 100.']
  if (!/^\d{1,4}$/.test(values.priority.trim()) || Number(values.priority) > 1000) errors.priority = ['Enter a priority from 0 to 1000 (lower runs first).']
  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) errors.endsAt = ['The end must be after the start.']
  return errors
}
const toPayload = (values) => ({
  name: values.name.trim(),
  description: values.description.trim() || null,
  isActive: values.isActive,
  startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
  endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
  action: values.action,
  amount: Number(values.amount),
  priority: Number(values.priority),
  stopFurther: values.stopFurther,
  customerGroupIds: values.customerGroupIds,
  categoryIds: values.categoryIds,
  productIds: values.productIds,
})
// "customerGroupIds.0" → shown on customerGroupIds.
const onField = (errors) => Object.fromEntries(Object.entries(errors ?? {}).map(([field, messages]) => [field.split('.')[0], messages]))

function CatalogRuleForm({ saved }) {
  const isNew = !saved
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const editable = can('price_rules.manage')
  const [values, setValues] = useState(() => (saved ? toForm(saved) : EMPTY_RULE))
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const { notice, setNotice, ref } = useNotice(location.state?.notice ? { tone: 'success', text: location.state.notice } : null)

  const change = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }
  const set = (field) => (event) => change(field, event.target.type === 'checkbox' ? event.target.checked : event.target.value)

  const save = useMutation({
    mutationFn: (body) => (isNew ? createCatalogRule(body) : updateCatalogRule(saved.id, body)),
    onSuccess: ({ rule }) => {
      queryClient.setQueryData(marketingKeys.rule(rule.id), { ...rule, live: true })
      queryClient.invalidateQueries({ queryKey: ['catalog-rules'] })
      queryClient.invalidateQueries({ queryKey: marketingKeys.rulePreview(rule.id) })
      const text = `${isNew ? 'Rule created' : 'Rule saved'}. ${rule.isActive ? 'The store’s prices follow it now.' : 'It is disabled, so prices don’t change.'}`
      if (isNew) return navigate(`/catalog-rules/${rule.id}`, { replace: true, state: { notice: text } })
      setDirty(false)
      setNotice({ tone: 'success', text })
      return undefined
    },
    onError: (error) => {
      setErrors(onField(error.fieldErrors))
      setNotice({ tone: 'error', text: error.message })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteCatalogRule(saved.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-rules'] })
      navigate('/catalog-rules', { replace: true })
    },
    onError: (error) => {
      setConfirmDelete(false)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  function submit(event) {
    event.preventDefault()
    const found = checkRule(values)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setNotice({ tone: 'error', text: 'Please check the highlighted fields.' })
      return
    }
    save.mutate(toPayload(values))
  }
  const err = (field) => errors[field]?.[0]
  const title = isNew ? 'Add catalog price rule' : saved.name

  return (
    <>
      <title>{`${title} | BuyNest Admin`}</title>
      <Link to="/catalog-rules" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Catalog price rules
      </Link>
      <PageHeader title={title} description={isNew ? 'A sale price for the products and shoppers you choose.' : <StatusBadge {...ruleStatus(saved.status)} />} />
      <Notice notice={notice} noticeRef={ref} />
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <div className="editor">
        <form className="form panel" noValidate onSubmit={submit}>
          <fieldset disabled={!editable} className="form__fieldset">
            <div className="form__grid">
              <Field label="Rule name" error={err('name')} hint="Shoppers see it on the cart line when the rule gives the price.">
                {(a11y) => <input {...a11y} value={values.name} maxLength={120} onChange={set('name')} />}
              </Field>
              <Field label="Description (optional)" error={err('description')} hint="For the team; shoppers don’t see it.">
                {(a11y) => <input {...a11y} value={values.description} maxLength={500} onChange={set('description')} />}
              </Field>
              <Field label="Discount type" error={err('action')}>
                {(a11y) => (
                  <select {...a11y} value={values.action} onChange={set('action')}>
                    <option value="percent">Percent off the price</option>
                    <option value="fixed">Fixed amount off the price</option>
                  </select>
                )}
              </Field>
              <Field label={values.action === 'percent' ? 'Percent off' : 'Amount off (USD)'} error={err('amount')} hint={values.action === 'percent' ? '0.01 to 100.' : 'Never below $0.01.'}>
                {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0.01" max={values.action === 'percent' ? 100 : undefined} step="0.01" value={values.amount} onChange={set('amount')} />}
              </Field>
              <Field label="Starts (optional)" error={err('startsAt')} hint="Your local time; empty to start now.">
                {(a11y) => <input {...a11y} type="datetime-local" value={values.startsAt} onChange={set('startsAt')} />}
              </Field>
              <Field label="Ends (optional)" error={err('endsAt')} hint="Your local time; empty for no end.">
                {(a11y) => <input {...a11y} type="datetime-local" value={values.endsAt} onChange={set('endsAt')} />}
              </Field>
              <Field label="Priority" error={err('priority')} hint="0 to 1000; lower runs first.">
                {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="0" max="1000" step="1" value={values.priority} onChange={set('priority')} />}
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={values.stopFurther} onChange={set('stopFurther')} />
              Stop further rules (rules with a later priority don’t apply after this one)
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={values.isActive} onChange={set('isActive')} />
              Active (applies within the dates above)
            </label>

            <h2 className="panel__title">Who and what it applies to</h2>
            <p className="field__hint">Every limit you set must match. A product’s price is the lowest of its own sale price and the rules’ price.</p>
            <GroupChecklist
              hint="None checked: everyone, including guests (shown in the catalog). With groups: applied in the cart and at checkout, labelled with the group’s price."
              selected={values.customerGroupIds}
              onChange={(ids) => change('customerGroupIds', ids)}
              error={err('customerGroupIds')}
              disabled={!editable}
            />
            <CategoryChecklist
              hint="None checked: every category. A category includes its subcategories."
              selected={values.categoryIds}
              onChange={(ids) => change('categoryIds', ids)}
              error={err('categoryIds')}
              disabled={!editable}
            />
            <ProductPicker
              legend="Products"
              hint={values.productIds.length === 0 ? 'None chosen: no product limit.' : `${values.productIds.length} chosen.`}
              selected={values.productIds}
              onChange={(ids) => change('productIds', ids)}
              error={err('productIds')}
              disabled={!editable}
              announce={setAnnouncement}
            />
          </fieldset>
          <div className="form__actions">
            {editable ? (
              <>
                <button type="submit" className="btn btn--primary" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : isNew ? 'Add rule' : 'Save rule'}
                </button>
                {!isNew && (
                  <button type="button" className="btn btn--outline" onClick={() => setConfirmDelete(true)}>
                    <LuTrash2 aria-hidden="true" /> Delete
                  </button>
                )}
              </>
            ) : (
              <span className="muted">Your role can view this rule but not change it.</span>
            )}
            <Link to="/catalog-rules" className="btn btn--outline">
              Cancel
            </Link>
          </div>
        </form>

        <RulePreview rule={saved} dirty={dirty} />
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={`Delete “${saved?.name}”?`}
        message="Its sale prices end at once. Orders already placed keep the prices they were charged."
        confirmLabel="Delete rule"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

/** The saved rule's effect: the first 50 matching products, price now → with this rule alone. */
function RulePreview({ rule, dirty }) {
  const preview = useQuery({ queryKey: marketingKeys.rulePreview(rule?.id), queryFn: ({ signal }) => getCatalogRulePreview(rule.id, { signal }), enabled: Boolean(rule) })
  return (
    <section className="panel editor__preview" aria-labelledby="rule-preview-title">
      <h2 id="rule-preview-title" className="panel__title">
        Affected products
      </h2>
      {!rule && <p className="muted">Save the rule to see which products it changes, and their new prices.</p>}
      {rule && (
        <>
          <p className="field__hint" aria-live="polite">
            {dirty ? 'You have unsaved changes: save to update this list.' : 'This rule alone, as saved (customer groups and dates aside, so a scheduled rule can be checked).'}
          </p>
          {preview.isPending && <Loading label="Finding the products…" />}
          {preview.error && <ErrorState error={preview.error} onRetry={preview.refetch} />}
          {preview.data && preview.data.products.length === 0 && <Empty>No products match this rule.</Empty>}
          {preview.data && preview.data.products.length > 0 && (
            <>
              <p className="muted">
                {preview.data.total > preview.data.products.length
                  ? `Showing the first ${formatCount(preview.data.products.length)} of ${formatCount(preview.data.total)} products.`
                  : `${formatCount(preview.data.total)} ${preview.data.total === 1 ? 'product' : 'products'}.`}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <caption className="visually-hidden">Products this rule changes, with their price now and with the rule</caption>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" className="num">
                        Now
                      </th>
                      <th scope="col" className="num">
                        With rule
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.products.map((product) => {
                      const wins = product.newPrice !== null && product.oldPrice !== null && product.newPrice < product.oldPrice
                      return (
                        <tr key={product.id}>
                          <th scope="row">
                            <Link to={`/products/${product.id}`}>{product.name}</Link>
                            <br />
                            <small className="muted">
                              {[product.sku, product.status !== 'active' && product.status, product.hasVariants && 'variants follow the rule'].filter(Boolean).join(' · ')}
                            </small>
                          </th>
                          <td className="num">{product.oldPrice === null ? '—' : formatMoney(product.oldPrice)}</td>
                          <td className="num">
                            {product.newPrice === null ? '—' : formatMoney(product.newPrice)}
                            {!wins && (
                              <>
                                <br />
                                <small className="muted">own price wins</small>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
