import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuMapPin, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import AddressForm from '../components/account/AddressForm'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { addressesQuery, customerKeys } from '../queries/customerQueries'
import { createAddress, deleteAddress, updateAddress } from '../services/customerService'
import { MAX_SAVED_ADDRESSES } from '../utils/addresses'
import { SITE } from '../constants/site'
import './AddressBookPage.css'

const fullName = (address) => [address.firstName, address.lastName].filter(Boolean).join(' ')

function AddressBlock({ address }) {
  return (
    <address className="address-book__address">
      <strong>{fullName(address)}</strong>
      {address.company && <span>{address.company}</span>}
      <span>{address.line1}</span>
      {address.line2 && <span>{address.line2}</span>}
      <span>
        {address.city}, {address.state} {address.postalCode}
      </span>
      <span>{address.country}</span>
      {address.phone && <span>{address.phone}</span>}
    </address>
  )
}

/**
 * /account/addresses (REAL_SHOP): the customer's address book. Add, edit, and
 * delete addresses, and choose the default shipping and billing address
 * (checkout fills those in). Up to 20 addresses; the server keeps one default
 * of each kind, so making one the default clears the other.
 */
function AddressBookPage() {
  const { user, authorizedRequest } = useAuth()
  const queryClient = useQueryClient()
  const request = useQuery(addressesQuery(user.id, authorizedRequest))
  const { settings, isPending: settingsPending } = useStoreSettings()
  const [editing, setEditing] = useState(null) // null | 'new' | an address id
  const [confirmingId, setConfirmingId] = useState(null)
  const [message, setMessage] = useState('')
  const key = customerKeys.addresses(user.id)

  // Any change can move a default flag on another address: fetch the book again afterwards.
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const save = useMutation({
    mutationFn: ({ id, values }) => authorizedRequest(() => (id ? updateAddress(id, values) : createAddress(values))),
    onSuccess: (_, { id }) => {
      setEditing(null)
      setMessage(id ? 'Address updated.' : 'Address added to your address book.')
      return refresh()
    },
  })

  const setDefault = useMutation({
    mutationFn: ({ id, kind }) => authorizedRequest(() => updateAddress(id, kind === 'billing' ? { isDefaultBilling: true } : { isDefaultShipping: true })),
    onSuccess: (_, { kind }) => {
      setMessage(kind === 'billing' ? 'Default billing address changed.' : 'Default shipping address changed.')
      return refresh()
    },
    onError: (error) => setMessage(`Couldn't change the default: ${error.message}`),
  })

  const remove = useMutation({
    mutationFn: (id) => authorizedRequest(() => deleteAddress(id)),
    onSuccess: () => {
      setConfirmingId(null)
      setMessage('Address deleted.')
      return refresh()
    },
    onError: (error) => setMessage(`Couldn't delete the address: ${error.message}`),
  })

  if (request.isPending || settingsPending) return <Loader label="Loading your addresses…" />
  if (request.error) {
    return <ErrorMessage title="We couldn't load your addresses" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
  }

  const addresses = request.data
  const isFull = addresses.length >= MAX_SAVED_ADDRESSES
  const busy = setDefault.isPending || remove.isPending
  const startEditing = (value) => {
    setMessage('')
    setConfirmingId(null)
    setEditing(value)
  }
  const form = (id, initialValues) => (
    <AddressForm
      title={id ? 'Edit address' : 'Add an address'}
      initialValues={initialValues}
      countries={settings.countries}
      submitLabel={id ? 'Save changes' : 'Add address'}
      onSave={(values) => save.mutateAsync({ id, values })}
      onCancel={() => setEditing(null)}
    />
  )

  return (
    <section className="address-book" aria-labelledby="address-book-title">
      <title>{`Address book | ${SITE.name}`}</title>
      <div className="address-book__header">
        <h2 id="address-book-title" className="address-book__title">
          Address book
        </h2>
        {editing !== 'new' && (
          <Button size="sm" onClick={() => startEditing('new')} disabled={isFull}>
            <LuPlus aria-hidden="true" /> Add address
          </Button>
        )}
      </div>
      <p className="address-book__note">
        {isFull
          ? `You've saved the most addresses we can keep (${MAX_SAVED_ADDRESSES}). Delete one to add another.`
          : 'Your default addresses are filled in at checkout, and you can pick any saved address there.'}
      </p>

      <p className="address-book__status" role="status">
        {message}
      </p>

      {editing === 'new' && form(null, { firstName: user.firstName ?? '', lastName: user.lastName ?? '', phone: user.phone ?? '', isDefaultShipping: addresses.length === 0, isDefaultBilling: addresses.length === 0 })}

      {addresses.length === 0 && editing !== 'new' ? (
        <EmptyState icon={LuMapPin} titleAs="h3" title="No saved addresses yet" message="Add an address to check out faster next time.">
          <Button onClick={() => startEditing('new')}>Add your first address</Button>
        </EmptyState>
      ) : (
        <ul className="address-book__list">
          {addresses.map((address) => {
            const name = fullName(address)
            if (editing === address.id) return <li key={address.id}>{form(address.id, address)}</li>
            return (
              <li key={address.id} className="address-book__card">
                {(address.isDefaultShipping || address.isDefaultBilling) && (
                  <p className="address-book__badges">
                    {address.isDefaultShipping && <span className="address-book__badge">Default shipping</span>}
                    {address.isDefaultBilling && <span className="address-book__badge">Default billing</span>}
                  </p>
                )}
                <AddressBlock address={address} />
                {confirmingId === address.id ? (
                  <div className="address-book__confirm" role="group" aria-label={`Delete the address for ${name}?`}>
                    <p>Delete this address?</p>
                    <Button size="sm" variant="secondary" onClick={() => remove.mutate(address.id)} disabled={remove.isPending}>
                      {remove.isPending ? 'Deleting…' : 'Yes, delete'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)} disabled={remove.isPending}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <div className="address-book__actions">
                    <Button size="sm" variant="outline" onClick={() => startEditing(address.id)} aria-label={`Edit the address for ${name}, ${address.line1}`}>
                      <LuPencil aria-hidden="true" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(address.id)} aria-label={`Delete the address for ${name}, ${address.line1}`} disabled={busy}>
                      <LuTrash2 aria-hidden="true" /> Delete
                    </Button>
                    {!address.isDefaultShipping && (
                      <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: address.id, kind: 'shipping' })} disabled={busy}>
                        Set as default shipping
                      </Button>
                    )}
                    {!address.isDefaultBilling && (
                      <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: address.id, kind: 'billing' })} disabled={busy}>
                        Set as default billing
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default AddressBookPage
