import { useEffect, useId } from 'react'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { chooseDisplayCurrency, setAvailableCurrencies, useDisplayCurrency } from '../../utils/displayCurrency'
import './CurrencyPicker.css'

/**
 * Phase 11 §5: "Show prices in" picker in the header. Only when the store
 * offers at least one display currency (never in the demo). The choice is
 * kept in this browser; orders are still charged in the base currency.
 * It also hands the store's currencies to the formatter (utils/displayCurrency.js).
 */
function CurrencyPicker() {
  const { settings } = useStoreSettings()
  const { available, active } = useDisplayCurrency()
  const selectId = useId()
  const base = settings.currencies?.base ?? 'USD'

  useEffect(() => {
    setAvailableCurrencies(settings.currencies?.display ?? [], settings.currencies?.base ?? 'USD')
  }, [settings.currencies])

  if (available.length === 0) return null

  return (
    <div className="currency-picker">
      <label htmlFor={selectId} className="visually-hidden">
        Show prices in
      </label>
      <select id={selectId} className="currency-picker__select" value={active?.code ?? base} onChange={(event) => chooseDisplayCurrency(event.target.value === base ? null : event.target.value)}>
        <option value={base}>{base}</option>
        {available.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} ({currency.symbol})
          </option>
        ))}
      </select>
    </div>
  )
}

export default CurrencyPicker
