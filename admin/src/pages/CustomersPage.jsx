import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuSearch } from 'react-icons/lu'
import { adminKeys, getCustomers, updateCustomer } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, fullName } from '../utils/format'

const LIMIT = 20
const ROLE_LABELS = { admin: 'Admin', moderator: 'Moderator', user: 'Customer' }
const STATUS_FILTERS = [
  { value: '', label: 'All customers' },
  { value: 'verified', label: 'Active' },
  { value: 'unverified', label: 'Email not confirmed' },
  { value: 'blocked', label: 'Blocked' },
]

/** A BuyNest customer's state, as icon + words. */
function accountStatus(customer) {
  if (!customer.isActive) return { tone: 'danger', label: 'Blocked' }
  if (!customer.emailVerified) return { tone: 'warning', label: 'Email not confirmed' }
  return { tone: 'success', label: 'Active' }
}

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
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [confirming, setConfirming] = useState(null) // the customer about to be blocked
  const [notice, setNotice] = useState(null)
  const queryClient = useQueryClient()

  const customers = useQuery({
    queryKey: adminKeys.customers({ q, status, skip }),
    queryFn: ({ signal }) => getCustomers({ q, status, skip, limit: LIMIT }, { signal }),
    placeholderData: keepPreviousData,
  })

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
    const next = { q, status, skip, ...changes }
    setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value !== '' && value !== 0)))
  }

  const manageable = customers.data?.manageable === true

  return (
    <>
      <title>Customers | BuyNest Admin</title>
      <PageHeader title="Customers" description={customers.data ? `${formatCount(customers.data.total)} accounts` : undefined} />
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
      </div>

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
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last sign-in</th>
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
                    <td>{fullName(customer)}</td>
                    <td>
                      <a href={`mailto:${customer.email}`}>{customer.email}</a>
                    </td>
                    <td>
                      <a href={`tel:${customer.phone}`}>{customer.phone}</a>
                    </td>
                    <td>
                      <StatusBadge {...accountStatus(customer)} />
                    </td>
                    <td>{formatDate(customer.createdAt)}</td>
                    <td>{formatDate(customer.lastLoginAt, 'Never')}</td>
                    <td>
                      {customer.isActive ? (
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
          <Pagination total={customers.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

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

export default CustomersPage
