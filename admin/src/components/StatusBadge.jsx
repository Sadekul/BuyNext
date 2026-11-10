import { LuCircleCheck, LuCircleX, LuInfo, LuTriangleAlert } from 'react-icons/lu'
import { stockStatus } from '../utils/stock'

const ICONS = { success: LuCircleCheck, warning: LuTriangleAlert, danger: LuCircleX, info: LuInfo, neutral: LuInfo }

/**
 * A state as icon + words (never color alone). Pass `stock` for a product's
 * stock state, or your own `tone` (success | warning | danger | info |
 * neutral), `label`, and optionally `icon` (utils/orders.js has them for
 * order, payment, and product statuses).
 */
function StatusBadge({ stock, tone: givenTone, label: givenLabel, icon }) {
  const { tone, label } = givenTone ? { tone: givenTone, label: givenLabel } : stockStatus(stock)
  const Icon = icon ?? ICONS[tone]
  return (
    <span className={`status status--${tone}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  )
}

export default StatusBadge
