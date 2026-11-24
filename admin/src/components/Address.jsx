import Field from './Field'
// Phase 14: Bangladesh addresses (division, district, area; mobile number).
import BdPlaceFields from './BdPlaceFields'
import { formatBdMobile, isBangladesh, placeName } from '../utils/bangladesh'

/** A postal address, as printed on a parcel. */
export function Address({ address }) {
  if (!address) return null
  if (isBangladesh(address.country)) return <BdAddress address={address} />
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

/**
 * Phase 14 §2: the Bangladesh format: house/road, area, district (with the
 * postcode), division, country, mobile. The names come from the API (English);
 * city and state are the district and division the server filled in.
 */
function BdAddress({ address }) {
  const area = placeName(address.area)
  const district = placeName(address.district) || address.city
  const division = placeName(address.division) || address.state
  const lines = [
    [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.company,
    address.line1,
    address.line2,
    area,
    [district, address.postalCode].filter(Boolean).join(' '),
    division && division !== district ? `${division} Division` : null,
    'Bangladesh',
    address.phone ? formatBdMobile(address.phone) : null,
  ].filter(Boolean)
  return (
    <address className="address">
      {lines.map((line, index) => (
        <span key={`${index}-${line}`}>
          {index > 0 && <br />}
          {line}
        </span>
      ))}
    </address>
  )
}

const err = (errors, field) => errors?.[field]?.[0]

/**
 * The address inputs, labelled and wired to their errors. `countries` (the
 * store's allowed countries) makes the country a select; otherwise free text.
 * Phase 14 §2: a Bangladesh address asks for the division, district, and area
 * instead of city and state, and its number is a Bangladeshi mobile. The country
 * field keeps its place (and focus) when the format changes.
 */
export function AddressFields({ value, onChange, errors = {}, countries, withContact = false, autoCompletePrefix = '' }) {
  const auto = (token) => `${autoCompletePrefix ? `${autoCompletePrefix} ` : ''}${token}`
  const props = { value, onChange, errors, withContact, auto, autoCompletePrefix }
  return (
    <div className="form__grid">
      {isBangladesh(value.country ?? '') ? <BdAddressInputs key="bd" {...props} /> : <AddressInputs key="other" {...props} />}
      <CountryField key="country" value={value} onChange={onChange} errors={errors} countries={countries} auto={auto} />
    </div>
  )
}

function AddressInputs({ value, onChange, errors, withContact, auto }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value })
  return (
    <>
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
    </>
  )
}

/** The country: a list of the store's countries, else free text. */
function CountryField({ value, onChange, errors, countries, auto }) {
  const set = (event) => {
    const country = event.target.value
    // Leaving or entering Bangladesh: the places of the other format don't apply.
    const switched = isBangladesh(country) !== isBangladesh(value.country ?? '')
    onChange({ ...value, country, ...(switched && { divisionId: '', districtId: '', areaId: '', city: '', state: '' }) })
  }
  return (
    <Field label="Country" error={err(errors, 'country')}>
      {(a11y) =>
        countries?.length ? (
          <select {...a11y} value={value.country} autoComplete={auto('country-name')} onChange={set}>
            <option value="">Choose…</option>
            {[...new Set([...countries, ...(value.country ? [value.country] : [])])].map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        ) : (
          <input {...a11y} value={value.country} maxLength={60} autoComplete={auto('country-name')} onChange={set} />
        )
      }
    </Field>
  )
}

/**
 * Phase 14 §2: a Bangladesh address: names, a Bangladeshi mobile number
 * (address book: the courier calls it; an order's number is the customer's
 * or the guest's), house/road/village, Division → District → Area, and an
 * optional 4-digit postcode (suggested from the area).
 */
function BdAddressInputs({ value, onChange, errors, withContact, auto, autoCompletePrefix }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value })
  return (
    <>
      <Field label="First name" error={err(errors, 'firstName')}>
        {(a11y) => <input {...a11y} value={value.firstName} maxLength={60} autoComplete={auto('given-name')} onChange={set('firstName')} />}
      </Field>
      <Field label="Last name" error={err(errors, 'lastName')}>
        {(a11y) => <input {...a11y} value={value.lastName} maxLength={60} autoComplete={auto('family-name')} onChange={set('lastName')} />}
      </Field>
      {withContact && (
        <Field label="Company (optional)" error={err(errors, 'company')}>
          {(a11y) => <input {...a11y} value={value.company ?? ''} maxLength={120} autoComplete={auto('organization')} onChange={set('company')} />}
        </Field>
      )}
      {withContact && (
        <Field label="Mobile number" error={err(errors, 'phone')} hint="A Bangladeshi mobile, like 01712 345678. The courier calls it.">
          {(a11y) => <input {...a11y} type="tel" inputMode="tel" value={value.phone ?? ''} maxLength={20} autoComplete={auto('tel')} onChange={set('phone')} />}
        </Field>
      )}
      <Field label="House, road, or village" error={err(errors, 'line1')} className="form__wide">
        {(a11y) => <input {...a11y} value={value.line1} maxLength={120} autoComplete={auto('address-line1')} onChange={set('line1')} />}
      </Field>
      <Field label="More details (optional)" error={err(errors, 'line2')} hint="A landmark, floor, or flat number." className="form__wide">
        {(a11y) => <input {...a11y} value={value.line2 ?? ''} maxLength={120} autoComplete={auto('address-line2')} onChange={set('line2')} />}
      </Field>
      <BdPlaceFields value={value} onChange={onChange} errors={errors} autoCompletePrefix={autoCompletePrefix} />
      <Field label="Postcode (optional)" error={err(errors, 'postalCode')} hint="4 digits. Filled in when the area has one postcode.">
        {(a11y) => <input {...a11y} value={value.postalCode ?? ''} inputMode="numeric" maxLength={4} autoComplete={auto('postal-code')} onChange={set('postalCode')} />}
      </Field>
    </>
  )
}
