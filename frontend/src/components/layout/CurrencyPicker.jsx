import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { chooseDisplayCurrency, setAvailableCurrencies, setStoreCurrency, useDisplayCurrency } from '../../utils/displayCurrency'
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
  const { t } = useTranslation('common')
  // Phase 12: the base is the store currency (USD or BDT).
  const base = settings.currency?.code ?? settings.currencies?.base ?? 'USD'

  useEffect(() => {
    // The service already set it when the settings loaded; this keeps it right if they come from elsewhere (cache, demo).
    setStoreCurrency(settings.currency)
    setAvailableCurrencies(settings.currencies?.display ?? [], base)
  }, [settings.currency, settings.currencies, base])

  if (available.length === 0) return null

  return (
    <div className="currency-picker">
      <label htmlFor={selectId} className="visually-hidden">
        {t('currency.showPricesIn')}
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
