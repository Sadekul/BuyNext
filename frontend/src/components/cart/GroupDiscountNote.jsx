import { LuBadgePercent } from 'react-icons/lu'
import { formatNumber, formatPrice } from '../../utils/formatters'
import './GroupDiscountNote.css'
import { useTranslation } from 'react-i18next'

/** "10%" or "7.5%": no trailing zeros. */
const percent = (value) => `${formatNumber(Number(value.toFixed(2)))}%`

/**
 * A signed-in customer's group price (REAL_SHOP, phase 6), e.g. "Wholesale
 * price: 10% off". The server has already taken it off every line's price;
 * `amount` (the server's total saving), when known, says how much that was.
 * Nothing is shown for groups without a discount (General, guests).
 * `format`: formatPrice (cart) or formatBasePrice (checkout: the charged amounts).
 */
function GroupDiscountNote({ group, amount, format = formatPrice }) {
  const { t } = useTranslation('cart')
  if (!group || !(group.discountPercent > 0)) return null
  return (
    <p className="group-discount">
      <LuBadgePercent aria-hidden="true" />
      <span>
        <strong>
          {t('group.price', { group: group.name, percent: percent(group.discountPercent) })}
        </strong>
        {amount > 0 ? t('group.save', { amount: format(amount) }) : t('group.included')}
      </span>
    </p>
  )
}

export default GroupDiscountNote
