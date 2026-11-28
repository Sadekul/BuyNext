import { LuCircleCheck, LuClock, LuEyeOff } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/classNames'
import './ReviewStatusBadge.css'

const ICONS = { pending: LuClock, approved: LuCircleCheck, rejected: LuEyeOff }

/**
 * Phase 23: where one of my reviews stands, in words (never colour alone):
 * "Waiting for approval", "Published" or "Not published". Used on My reviews
 * and on the product page's "You've already reviewed this product".
 */
function ReviewStatusBadge({ status, className }) {
  const { t } = useTranslation('catalog')
  const known = ICONS[status] ? status : 'pending'
  const Icon = ICONS[known]
  return (
    <span className={cn('review-status', `review-status--${known}`, className)}>
      <Icon aria-hidden="true" />
      {t(`reviewStatus.${known}`)}
    </span>
  )
}

export default ReviewStatusBadge
