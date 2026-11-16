import { LuBadgePercent } from 'react-icons/lu'
import { formatPrice } from '../../utils/formatters'
import './GroupDiscountNote.css'

/** "10%" or "7.5%": no trailing zeros. */
const percent = (value) => `${Number(value.toFixed(2))}%`

/**
 * A signed-in customer's group price (REAL_SHOP, phase 6), e.g. "Wholesale
 * price: 10% off". The server has already taken it off every line's price;
 * `amount` (the server's total saving), when known, says how much that was.
 * Nothing is shown for groups without a discount (General, guests).
 */
function GroupDiscountNote({ group, amount }) {
  if (!group || !(group.discountPercent > 0)) return null
  return (
    <p className="group-discount">
      <LuBadgePercent aria-hidden="true" />
      <span>
        <strong>
          {group.name} price: {percent(group.discountPercent)} off
        </strong>
        {amount > 0 ? `. You save ${formatPrice(amount)}; it's already included in your prices.` : ". It's already included in your prices."}
      </span>
    </p>
  )
}

export default GroupDiscountNote
