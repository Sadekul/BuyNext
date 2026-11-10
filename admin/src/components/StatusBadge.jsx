import { LuCircleCheck, LuCircleX, LuTriangleAlert } from 'react-icons/lu'
import { stockStatus } from '../utils/stock'

const ICONS = { success: LuCircleCheck, warning: LuTriangleAlert, danger: LuCircleX }

/** Stock state as icon + words (never color alone), with the unit count. */
function StatusBadge({ stock }) {
  const { tone, label } = stockStatus(stock)
  const Icon = ICONS[tone]
  return (
    <span className={`status status--${tone}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  )
}

export default StatusBadge
