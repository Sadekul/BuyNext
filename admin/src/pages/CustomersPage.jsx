import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuDownload, LuSearch, LuUserPlus } from 'react-icons/lu'
import { adminKeys, createCustomer, customersCsvUrl, getCustomerGroups, getCustomers, updateCustomer } from '../api/admin'
import { LIVE_DATA } from '../api/mode'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, fullName } from '../utils/format'
import { useAdminAuth } from '../auth/useAdminAuth'
import { accountStatus } from '../utils/customers'
// Phase 7: column chooser, rows per page, saved filters (BuyNest's backend).
import GridPreferences from '../components/GridPreferences'
import { useGridPreferences } from '../utils/useGridPreferences'

const COLUMNS = [
  { id: 'name', label: 'Name', required: true },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'group', label: 'Group' },
  { id: 'status', label: 'Status' },
  { id: 'joined', label: 'Joined' },
  { id: 'lastLogin', label: 'Last sign-in' },
]
const ROLE_LABELS = { admin: 'Admin', moderator: 'Moderator', user: 'Customer' }
const VERIFIED_FILTERS = [
  { value: '', label: 'Confirmed or not' },
  { value: 'yes', label: 'Confirmed' },
  { value: 'no', label: 'Not confirmed' },
]
const STATUS_FILTERS = [
  { value: '', label: 'All customers' },
  { value: 'verified', label: 'Active' },
  { value: 'unverified', label: 'Email not confirmed' },
  { value: 'blocked', label: 'Blocked' },
]


/**
 * Customer accounts (like Magento's Customers > All Customers). The server
 * sends contact fields only: no passwords, bank, or ID numbers.
 * With BuyNest accounts (`manageable`), these are the real sign-ups: filter
 * by status, and block or unblock an account. Blocking signs the customer out
 * everywhere and stops them signing in. With the DummyJSON demo users the
 * list is read-only.
 */
function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  // Phase 6 filters (BuyNest's backend): email confirmed, group, joined between.
  const verified = params.get('verified') ?? ''
  const groupId = params.get('groupId') ?? ''
  const createdFrom = params.get('createdFrom') ?? ''
  const createdTo = params.get('createdTo') ?? ''
  const skip = Number(params.get('skip')) || 0
  const grid = useGridPreferences('customers_grid', COLUMNS)
  const limit = grid.pageSize
  const [draft, setDraft] = useState(q)
  const [confirming, setConfirming] = useState(null) // the customer about to be blocked
  const [adding, setAdding] = useState(false)
  const location = useLocation()
  // A deleted customer's page comes back here with what happened.
  const [notice, setNotice] = useState(location.state?.notice ?? null)
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()

  const filters = LIVE_DATA ? { q, status, verified, groupId, createdFrom, createdTo } : { q, status }
  const customers = useQuery({
    queryKey: adminKeys.customers({ ...filters, skip, limit }),
    queryFn: ({ signal }) => getCustomers({ ...filters, skip, limit }, { signal }),
    placeholderData: keepPreviousData,
  })
  const groups = useQuery({ queryKey: adminKeys.customerGroups, queryFn: ({ signal }) => getCustomerGroups({ signal }), enabled: LIVE_DATA, staleTime: 60_000 })

  const setActive = useMutation({
    mutationFn: ({ customer, isActive }) => updateCustomer(customer.id, { isActive }),
    onSuccess: (updated) => {
      setNotice(
        updated.isActive
          ? `${fullName(updated)} can sign in again.`
          : `${fullName(updated)} is blocked and has been signed out everywhere.`,
      )
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => setNotice(`Couldn't change the account: ${error.message}`),
    onSettled: () => setConfirming(null),
  })

  const update = (changes) => {
    const next = { ...filters, skip, ...changes }
    setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value !== '' && value !== 0)))
  }

  const manageable = customers.data?.manageable === true
  // The profile, groups, and CSV need BuyNest's backend (phase 6).
  const profiles = LIVE_DATA && manageable

  return (
    <>
      <title>Customers | BuyNest Admin</title>
      <PageHeader
        title="Customers"
        description={customers.data ? `${formatCount(customers.data.total)} accounts` : undefined}
        actions={
          LIVE_DATA && (
            <>
              <a href={customersCsvUrl(filters)} className="btn btn--outline" download>
                <LuDownload aria-hidden="true" /> Export CSV
              </a>
              {can('customers.create') && (
                <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
                  <LuUserPlus aria-hidden="true" /> Add customer
                </button>
              )}
            </>
          )
        }
      />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="customer-search" className="visually-hidden">
            Search customers
          </label>
          <input
            id="customer-search"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={manageable ? 'Search by name, email, or phone' : 'Search by name or email'}
          />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        {manageable && (
          <label className="toolbar__select">
            <span>Status</span>
            <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {profiles && (
          <>
            <label className="toolbar__select">
              <span>Email</span>
              <select value={verified} onChange={(event) => update({ verified: event.target.value, skip: 0 })}>
                {VERIFIED_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="toolbar__select">
              <span>Group</span>
              <select value={groupId} onChange={(event) => update({ groupId: event.target.value, skip: 0 })}>
                <option value="">All groups</option>
                {(groups.data?.groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="toolbar__select">
              <span>Joined from</span>
              <input type="date" value={createdFrom} max={createdTo || undefined} onChange={(event) => update({ createdFrom: event.target.value, skip: 0 })} />
            </label>
            <label className="toolbar__select">
              <span>Joined to</span>
              <input type="date" value={createdTo} min={createdFrom || undefined} onChange={(event) => update({ createdTo: event.target.value, skip: 0 })} />
            </label>
          </>
        )}
      </div>

      {profiles && (
        <GridPreferences
          prefs={grid}
          noun="customers"
          onPageSize={() => update({ skip: 0 })}
          current={filters}
          onApply={(saved) => {
            setDraft(saved.q ?? '')
            setParams(new URLSearchParams(Object.entries(saved).filter(([, value]) => value !== '' && value !== null)))
          }}
        />
      )}
      {customers.isPending && <Loading label="Loading customers…" />}
      {customers.error && <ErrorState error={customers.error} onRetry={customers.refetch} />}
      {customers.data && customers.data.customers.length === 0 && <Empty>No customers match.</Empty>}
      {customers.data && customers.data.customers.length > 0 && (
        <div className="table-wrap" aria-busy={customers.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Customer accounts</caption>
            <thead>
              {manageable ? (
                <tr>
                  <th scope="col">Name</th>
                  {grid.isVisible('email') && <th scope="col">Email</th>}
                  {grid.isVisible('phone') && <th scope="col">Phone</th>}
                  {profiles && grid.isVisible('group') && <th scope="col">Group</th>}
                  {grid.isVisible('status') && <th scope="col">Status</th>}
                  {grid.isVisible('joined') && <th scope="col">Joined</th>}
                  {grid.isVisible('lastLogin') && <th scope="col">Last sign-in</th>}
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              ) : (
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Location</th>
                  <th scope="col">Role</th>
                </tr>
              )}
            </thead>
            <tbody>
              {customers.data.customers.map((customer) =>
                manageable ? (
                  <tr key={customer.id}>
                    <td>{profiles ? <Link to={`/customers/${customer.id}`}>{fullName(customer)}</Link> : fullName(customer)}</td>
                    {grid.isVisible('email') && (
                      <td>
                        <a href={`mailto:${customer.email}`}>{customer.email}</a>
                      </td>
                    )}
                    {grid.isVisible('phone') && <td>{customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : <span className="muted">—</span>}</td>}
                    {profiles && grid.isVisible('group') && <td>{customer.group?.name ?? '—'}</td>}
                    {grid.isVisible('status') && (
                      <td>
                        <StatusBadge {...accountStatus(customer)} />
                      </td>
                    )}
                    {grid.isVisible('joined') && <td>{formatDate(customer.createdAt)}</td>}
                    {grid.isVisible('lastLogin') && <td>{formatDate(customer.lastLoginAt, 'Never')}</td>}
                    <td>
                      {!can('customers.edit') ? null : customer.isActive ? (
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          aria-label={`Block ${fullName(customer)}`}
                          onClick={() => setConfirming(customer)}
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          aria-label={`Unblock ${fullName(customer)}`}
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ customer, isActive: true })}
                        >
                          Unblock
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={customer.id}>
                    <td>
                      <span className="table__product">
                        <img src={customer.image} alt="" width="32" height="32" loading="lazy" />
                        <span>
                          {fullName(customer)}
                          <small>@{customer.username}</small>
                        </span>
                      </span>
                    </td>
                    <td>
                      <a href={`mailto:${customer.email}`}>{customer.email}</a>
                    </td>
                    <td>{[customer.city, customer.country].filter(Boolean).join(', ')}</td>
                    <td>{ROLE_LABELS[customer.role] ?? customer.role}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <Pagination total={customers.data.total} limit={limit} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      {adding && <AddCustomerDialog groups={groups.data?.groups ?? []} onCancel={() => setAdding(false)} />}

      <ConfirmDialog
        isOpen={confirming !== null}
        title={confirming ? `Block ${fullName(confirming)}?` : 'Block this customer?'}
        message="They are signed out on every device and can't sign in until you unblock the account. Their orders are kept."
        confirmLabel="Block account"
        busy={setActive.isPending}
        onConfirm={() => setActive.mutate({ customer: confirming, isActive: false })}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

const EMPTY_CUSTOMER = { firstName: '', lastName: '', email: '', phone: '', groupId: '' }

/**
 * "Add customer" (customers.create): the account has no password; the
 * customer gets an email with a code to set one (the forgot-password flow).
 * Afterwards the new customer's page opens.
 */
function AddCustomerDialog({ groups, onCancel }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [values, setValues] = useState(EMPTY_CUSTOMER)
  const [errors, setErrors] = useState({})
  const create = useMutation({
    mutationFn: (body) => createCustomer(body),
    onSuccess: ({ customer }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      navigate(`/customers/${customer.id}`, { state: { notice: `${fullName(customer)} added. They were emailed a link to set their password.` } })
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  const set = (field) => (event) => setValues({ ...values, [field]: event.target.value })

  function submit() {
    const found = {}
    if (!values.firstName.trim()) found.firstName = ['Enter the first name.']
    if (!values.lastName.trim()) found.lastName = ['Enter the last name.']
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) found.email = ['Enter a valid email address.']
    if (!values.phone.trim()) found.phone = ['Enter a phone number with its country code.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    create.mutate({
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      ...(values.groupId && { groupId: Number(values.groupId) }),
    })
  }

  const fieldError = (field) => errors[field]?.[0]
  const shown = ['firstName', 'lastName', 'email', 'phone', 'groupId']
  const other = create.error && (Object.entries(create.error.fieldErrors ?? {}).find(([field]) => !shown.includes(field))?.[1][0] ?? (create.error.fieldErrors ? null : create.error.message))
  return (
    <FormDialog
      isOpen
      title="Add customer"
      description="The customer gets an email with a code to set their own password. You never see or set it."
      submitLabel="Add customer"
      busy={create.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <div className="form__grid">
        <Field label="First name" error={fieldError('firstName')}>
          {(a11y) => <input {...a11y} value={values.firstName} maxLength={60} autoComplete="off" onChange={set('firstName')} />}
        </Field>
        <Field label="Last name" error={fieldError('lastName')}>
          {(a11y) => <input {...a11y} value={values.lastName} maxLength={60} autoComplete="off" onChange={set('lastName')} />}
        </Field>
      </div>
      <Field label="Email" error={fieldError('email')}>
        {(a11y) => <input {...a11y} type="email" value={values.email} maxLength={190} autoComplete="off" onChange={set('email')} />}
      </Field>
      <Field label="Phone" error={fieldError('phone')} hint="With the country code, for example +1 555 010 0100.">
        {(a11y) => <input {...a11y} type="tel" value={values.phone} maxLength={40} autoComplete="off" onChange={set('phone')} />}
      </Field>
      <Field label="Customer group" error={fieldError('groupId')} hint="Empty: the default group (General).">
        {(a11y) => (
          <select {...a11y} value={values.groupId} onChange={set('groupId')}>
            <option value="">Default group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
                {group.discountPercent > 0 ? ` (${group.discountPercent}% off)` : ''}
              </option>
            ))}
          </select>
        )}
      </Field>
    </FormDialog>
  )
}

export default CustomersPage
