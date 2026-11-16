import { useEffect, useRef, useState } from 'react'
import { LuBan, LuCalendarClock, LuCircleCheck, LuCircleSlash, LuClock, LuMailCheck, LuMailX, LuSend } from 'react-icons/lu'
import { formatMoney } from './format'

/*
 * Phase 7 marketing: statuses for StatusBadge (icon + words; the tone only
 * adds colour) and small helpers shared by the marketing screens.
 */

const unknown = (status) => ({ label: status ?? 'Unknown', tone: 'neutral', icon: LuClock })

export const RULE_STATUSES = {
  active: { label: 'Active', tone: 'success', icon: LuCircleCheck },
  inactive: { label: 'Disabled', tone: 'neutral', icon: LuCircleSlash },
  scheduled: { label: 'Scheduled', tone: 'info', icon: LuCalendarClock },
  expired: { label: 'Expired', tone: 'warning', icon: LuClock },
}
export const ruleStatus = (status) => RULE_STATUSES[status] ?? unknown(status)

export const SUBSCRIBER_STATUSES = {
  pending: { label: 'Awaiting confirmation', tone: 'warning', icon: LuClock },
  subscribed: { label: 'Subscribed', tone: 'success', icon: LuMailCheck },
  unsubscribed: { label: 'Unsubscribed', tone: 'neutral', icon: LuMailX },
}
export const subscriberStatus = (status) => SUBSCRIBER_STATUSES[status] ?? unknown(status)
export const SUBSCRIBER_SOURCES = { footer: 'Store footer', account: 'Customer account', checkout: 'Checkout', admin: 'Admin' }

export const CAMPAIGN_STATUSES = {
  draft: { label: 'Draft', tone: 'neutral', icon: LuCircleSlash },
  sending: { label: 'Sending', tone: 'info', icon: LuSend },
  sent: { label: 'Sent', tone: 'success', icon: LuCircleCheck },
}
export const campaignStatus = (status) => CAMPAIGN_STATUSES[status] ?? unknown(status)

export const remindBlocked = { label: 'Can’t remind yet', tone: 'neutral', icon: LuBan }

/** "15% off", "$2.00 off". */
export const describeRuleAction = (rule) => (rule.action === 'percent' ? `${Number(rule.amount)}% off` : `${formatMoney(rule.amount)} off`)

/** "3 groups · 2 categories · all products" — what a rule is limited to. */
export function describeScope({ customerGroupIds = [], categoryIds = [], productIds = [] }) {
  const count = (list, one, many) => `${list.length} ${list.length === 1 ? one : many}`
  return [
    customerGroupIds.length ? count(customerGroupIds, 'group', 'groups') : 'Everyone',
    categoryIds.length ? count(categoryIds, 'category', 'categories') : null,
    productIds.length ? count(productIds, 'product', 'products') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** "3 hours", "2 days". */
export function formatAge(minutes) {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `${days} days`
}

/**
 * A page-level message (announced: role status, or alert for errors) that
 * takes focus, so keyboard and screen reader users land on the result.
 */
export function useNotice(initial = null) {
  const [notice, setNotice] = useState(initial)
  const ref = useRef(null)
  useEffect(() => {
    if (notice) ref.current?.focus()
  }, [notice])
  return { notice, setNotice, ref }
}
