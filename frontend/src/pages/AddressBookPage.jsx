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
import { useTranslation } from 'react-i18next'
import { translate } from '../i18n'

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
      <span>{translate(`common:countries.${address.country}`, { defaultValue: address.country })}</span>
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
  const { t } = useTranslation('account')
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
      setMessage(t(id ? 'addresses.updated' : 'addresses.added'))
      return refresh()
    },
  })

  const setDefault = useMutation({
    mutationFn: ({ id, kind }) => authorizedRequest(() => updateAddress(id, kind === 'billing' ? { isDefaultBilling: true } : { isDefaultShipping: true })),
    onSuccess: (_, { kind }) => {
      setMessage(t(kind === 'billing' ? 'addresses.defaultBilling' : 'addresses.defaultShipping'))
      return refresh()
    },
    onError: (error) => setMessage(t('addresses.defaultFailed', { reason: error.message })),
  })

  const remove = useMutation({
    mutationFn: (id) => authorizedRequest(() => deleteAddress(id)),
    onSuccess: () => {
      setConfirmingId(null)
      setMessage(t('addresses.deleted'))
      return refresh()
    },
    onError: (error) => setMessage(t('addresses.deleteFailed', { reason: error.message })),
  })

  if (request.isPending || settingsPending) return <Loader label={t('addresses.loading')} />
  if (request.error) {
    return <ErrorMessage title={t('addresses.failed')} titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
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
      title={t(id ? 'addresses.edit' : 'addresses.addTitle')}
      initialValues={initialValues}
      countries={settings.countries}
      submitLabel={t(id ? 'addresses.saveChanges' : 'addresses.addButton')}
      onSave={(values) => save.mutateAsync({ id, values })}
      onCancel={() => setEditing(null)}
    />
  )

  return (
    <section className="address-book" aria-labelledby="address-book-title">
      <title>{`${t('addresses.tabTitle')} | ${SITE.name}`}</title>
      <div className="address-book__header">
        <h2 id="address-book-title" className="address-book__title">
          {t('addresses.title')}
        </h2>
        {editing !== 'new' && (
          <Button size="sm" onClick={() => startEditing('new')} disabled={isFull}>
            <LuPlus aria-hidden="true" /> {t('addresses.addButton')}
          </Button>
        )}
      </div>
      <p className="address-book__note">
        {isFull
          ? t('addresses.full', { max: MAX_SAVED_ADDRESSES })
          : t('addresses.note')}
      </p>

      <p className="address-book__status" role="status">
        {message}
      </p>

      {editing === 'new' && form(null, { firstName: user.firstName ?? '', lastName: user.lastName ?? '', phone: user.phone ?? '', isDefaultShipping: addresses.length === 0, isDefaultBilling: addresses.length === 0 })}

      {addresses.length === 0 && editing !== 'new' ? (
        <EmptyState icon={LuMapPin} titleAs="h3" title={t('addresses.empty')} message={t('addresses.emptyMessage')}>
          <Button onClick={() => startEditing('new')}>{t('addresses.addFirst')}</Button>
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
                    {address.isDefaultShipping && <span className="address-book__badge">{t('addresses.badgeShipping')}</span>}
                    {address.isDefaultBilling && <span className="address-book__badge">{t('addresses.badgeBilling')}</span>}
                  </p>
                )}
                <AddressBlock address={address} />
                {confirmingId === address.id ? (
                  <div className="address-book__confirm" role="group" aria-label={t('addresses.deleteGroup', { name })}>
                    <p>{t('addresses.deleteQuestion')}</p>
                    <Button size="sm" variant="secondary" onClick={() => remove.mutate(address.id)} disabled={remove.isPending}>
                      {t(remove.isPending ? 'addresses.deleting' : 'addresses.yesDelete')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)} disabled={remove.isPending}>
                      {t('addresses.keep')}
                    </Button>
                  </div>
                ) : (
                  <div className="address-book__actions">
                    <Button size="sm" variant="outline" onClick={() => startEditing(address.id)} aria-label={t('addresses.editLabel', { name, line: address.line1 })}>
                      <LuPencil aria-hidden="true" /> {t('addresses.editButton')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(address.id)} aria-label={t('addresses.deleteLabel', { name, line: address.line1 })} disabled={busy}>
                      <LuTrash2 aria-hidden="true" /> {t('addresses.deleteButton')}
                    </Button>
                    {!address.isDefaultShipping && (
                      <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: address.id, kind: 'shipping' })} disabled={busy}>
                        {t('addresses.setShipping')}
                      </Button>
                    )}
                    {!address.isDefaultBilling && (
                      <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: address.id, kind: 'billing' })} disabled={busy}>
                        {t('addresses.setBilling')}
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
