import { useId } from 'react'
import { addressSummary, isSameAddress } from '../../utils/addresses'

/**
 * "Use a saved address" for signed-in customers at checkout (REAL_SHOP).
 * Choosing one copies it into the address fields below (`onChoose`); the
 * select shows which saved address the fields match right now, or "a new
 * address" once the shopper types something else.
 */
function SavedAddressPicker({ label, addresses, current, onChoose }) {
  const id = useId()
  const selected = addresses.find((saved) => isSameAddress(saved, current))

  function handleChange(event) {
    const saved = addresses.find((address) => String(address.id) === event.target.value)
    if (saved) onChoose(saved)
  }

  return (
    <div className="form-field">
      <label htmlFor={id} className="form-field__label">
        {label}
      </label>
      <select id={id} className="form-field__input form-field__select" value={selected ? String(selected.id) : ''} onChange={handleChange}>
        <option value="">A new address (fill in below)</option>
        {addresses.map((address) => (
          <option key={address.id} value={String(address.id)}>
            {addressSummary(address)}
          </option>
        ))}
      </select>
    </div>
  )
}

export default SavedAddressPicker
