import Field from './Field'

/** A postal address, as printed on a parcel. */
export function Address({ address }) {
  if (!address) return null
  return (
    <address className="address">
      {[address.firstName, address.lastName].filter(Boolean).join(' ')}
      {address.company && (
        <>
          <br />
          {address.company}
        </>
      )}
      <br />
      {address.line1}
      {address.line2 && (
        <>
          <br />
          {address.line2}
        </>
      )}
      <br />
      {address.city}
      {address.state ? `, ${address.state}` : ''} {address.postalCode}
      <br />
      {address.country}
      {address.phone && (
        <>
          <br />
          {address.phone}
        </>
      )}
    </address>
  )
}

const err = (errors, field) => errors?.[field]?.[0]

/**
 * The address inputs, labelled and wired to their errors. `countries` (the
 * store's allowed countries) makes the country a select; otherwise free text.
 */
export function AddressFields({ value, onChange, errors = {}, countries, withContact = false, autoCompletePrefix = '' }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value })
  const auto = (token) => `${autoCompletePrefix ? `${autoCompletePrefix} ` : ''}${token}`
  return (
    <div className="form__grid">
      <Field label="First name" error={err(errors, 'firstName')}>
        {(a11y) => <input {...a11y} value={value.firstName} maxLength={60} autoComplete={auto('given-name')} onChange={set('firstName')} />}
      </Field>
      <Field label="Last name" error={err(errors, 'lastName')}>
        {(a11y) => <input {...a11y} value={value.lastName} maxLength={60} autoComplete={auto('family-name')} onChange={set('lastName')} />}
      </Field>
      {withContact && (
        <>
          <Field label="Company (optional)" error={err(errors, 'company')}>
            {(a11y) => <input {...a11y} value={value.company ?? ''} maxLength={120} autoComplete={auto('organization')} onChange={set('company')} />}
          </Field>
          <Field label="Phone" error={err(errors, 'phone')} hint="With the country code, for example +1 555 010 0100.">
            {(a11y) => <input {...a11y} type="tel" value={value.phone ?? ''} maxLength={40} autoComplete={auto('tel')} onChange={set('phone')} />}
          </Field>
        </>
      )}
      <Field label="Address" error={err(errors, 'line1')} className="form__wide">
        {(a11y) => <input {...a11y} value={value.line1} maxLength={120} autoComplete={auto('address-line1')} onChange={set('line1')} />}
      </Field>
      <Field label="Address line 2 (optional)" error={err(errors, 'line2')} className="form__wide">
        {(a11y) => <input {...a11y} value={value.line2 ?? ''} maxLength={120} autoComplete={auto('address-line2')} onChange={set('line2')} />}
      </Field>
      <Field label="City" error={err(errors, 'city')}>
        {(a11y) => <input {...a11y} value={value.city} maxLength={80} autoComplete={auto('address-level2')} onChange={set('city')} />}
      </Field>
      <Field label="State or region (optional)" error={err(errors, 'state')}>
        {(a11y) => <input {...a11y} value={value.state ?? ''} maxLength={80} autoComplete={auto('address-level1')} onChange={set('state')} />}
      </Field>
      <Field label="Postal code" error={err(errors, 'postalCode')}>
        {(a11y) => <input {...a11y} value={value.postalCode} maxLength={10} autoComplete={auto('postal-code')} onChange={set('postalCode')} />}
      </Field>
      <Field label="Country" error={err(errors, 'country')}>
        {(a11y) =>
          countries?.length ? (
            <select {...a11y} value={value.country} autoComplete={auto('country-name')} onChange={set('country')}>
              <option value="">Choose…</option>
              {[...new Set([...countries, ...(value.country ? [value.country] : [])])].map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          ) : (
            <input {...a11y} value={value.country} maxLength={60} autoComplete={auto('country-name')} onChange={set('country')} />
          )
        }
      </Field>
    </div>
  )
}
