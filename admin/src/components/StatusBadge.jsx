import { LuCircleCheck, LuCircleX, LuTriangleAlert } from 'react-icons/lu'
import { stockStatus } from '../utils/stock'

const ICONS = { success: LuCircleCheck, warning: LuTriangleAlert, danger: LuCircleX }

/**
 * A state as icon + words (never color alone). Pass `stock` for a product's
 * stock state, or your own `tone` (success | warning | danger) and `label`.
 */
function StatusBadge({ stock, tone: givenTone, label: givenLabel }) {
  const { tone, label } = givenTone ? { tone: givenTone, label: givenLabel } : stockStatus(stock)
  const Icon = ICONS[tone]
  return (
    <span className={`status status--${tone}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  )
}

export default StatusBadge
