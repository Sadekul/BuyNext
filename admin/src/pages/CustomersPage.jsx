import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuSearch } from 'react-icons/lu'
import { adminKeys, getCustomers } from '../api/admin'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, fullName } from '../utils/format'

const LIMIT = 20
const ROLE_LABELS = { admin: 'Admin', moderator: 'Moderator', user: 'Customer' }

/** Customer accounts. The server sends contact fields only: no passwords, bank, or ID numbers. */
function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const customers = useQuery({
    queryKey: adminKeys.customers({ q, skip }),
    queryFn: ({ signal }) => getCustomers({ q, skip, limit: LIMIT }, { signal }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <title>Customers | BuyNest Admin</title>
      <PageHeader title="Customers" description={customers.data ? `${formatCount(customers.data.total)} accounts` : undefined} />
      <form
        role="search"
        className="toolbar toolbar__search"
        onSubmit={(event) => {
          event.preventDefault()
          setParams(draft.trim() ? { q: draft.trim() } : {})
        }}
      >
        <label htmlFor="customer-search" className="visually-hidden">
          Search customers
        </label>
        <input id="customer-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search by name or email" />
        <button type="submit" className="btn btn--outline">
          <LuSearch aria-hidden="true" /> Search
        </button>
      </form>
      {customers.isPending && <Loading label="Loading customers…" />}
      {customers.error && <ErrorState error={customers.error} onRetry={customers.refetch} />}
      {customers.data && customers.data.customers.length === 0 && <Empty>No customers match.</Empty>}
      {customers.data && customers.data.customers.length > 0 && (
        <div className="table-wrap" aria-busy={customers.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Location</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {customers.data.customers.map((customer) => (
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
              ))}
            </tbody>
          </table>
          <Pagination
            total={customers.data.total}
            limit={LIMIT}
            skip={skip}
            onChange={(next) => setParams({ ...(q && { q }), ...(next && { skip: String(next) }) })}
          />
        </div>
      )}
    </>
  )
}

export default CustomersPage
