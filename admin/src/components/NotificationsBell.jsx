import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuBell, LuCircleAlert, LuInfo, LuTriangleAlert, LuX } from 'react-icons/lu'
import { getNotifications, markAllNotificationsRead, markNotificationRead, systemKeys } from '../api/admin'
import { formatCount, formatDate } from '../utils/format'

const POLL_MS = 60_000
const SEVERITY = {
  critical: { icon: LuCircleAlert, label: 'Critical' },
  warning: { icon: LuTriangleAlert, label: 'Warning' },
  info: { icon: LuInfo, label: 'Info' },
}
// The store's own screens open in the app; anything else isn't a link here.
const appPath = (link) => (typeof link === 'string' && /^\/(?!\/)/.test(link) ? link.replace(/^\/admin(?=\/|$)/, '') || '/' : null)

/**
 * The header's notifications (Magento's System messages), PHASE7_CONTRACT.md §7.
 * The server sends only what the admin's role may see. The unread count is
 * polled every 60 seconds (paused while the tab is hidden) and is part of
 * the button's name. The list opens in a non-modal popover: focus moves into
 * it, Escape or "Close" returns focus to the button.
 */
function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const titleId = useId()
  const queryClient = useQueryClient()

  const notifications = useQuery({
    queryKey: systemKeys.notifications,
    queryFn: ({ signal }) => getNotifications({ limit: 20 }, { signal }),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
  const list = notifications.data?.notifications ?? []
  const unread = notifications.data?.unreadCount ?? list.filter((item) => !item.readAt).length

  const markRead = useMutation({
    mutationFn: (item) => markNotificationRead(item.id),
    onSuccess: (_, item) => {
      queryClient.setQueryData(systemKeys.notifications, (current) =>
        current && { ...current, notifications: current.notifications.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)), unreadCount: Math.max(0, (current.unreadCount ?? 1) - 1) },
      )
      setMessage(`Marked "${item.title}" as read.`)
    },
    onError: (error) => setMessage(`Couldn't mark it as read: ${error.message}`),
  })
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.setQueryData(systemKeys.notifications, (current) =>
        current && { ...current, notifications: current.notifications.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })), unreadCount: 0 },
      )
      setMessage('All notifications marked as read.')
      panelRef.current?.querySelector('h2')?.focus()
    },
    onError: (error) => setMessage(`Couldn't mark them as read: ${error.message}`),
  })

  function close({ restoreFocus = true } = {}) {
    setOpen(false)
    setMessage('')
    if (restoreFocus) buttonRef.current?.focus()
  }

  // Into the popover on open; outside clicks close it (without stealing focus back).
  useEffect(() => {
    if (!open) return undefined
    panelRef.current?.querySelector('h2')?.focus()
    const onPointerDown = (event) => {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
      setOpen(false)
      setMessage('')
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const name = unread > 0 ? `Notifications, ${formatCount(unread)} unread` : 'Notifications'
  return (
    <div className="bell">
      <button
        ref={buttonRef}
        type="button"
        className="bell__button"
        aria-label={name}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <LuBell aria-hidden="true" />
        {unread > 0 && (
          <span className="bell__count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="bell__panel"
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            }
          }}
        >
          <div className="bell__header">
            <h2 id={titleId} tabIndex={-1}>
              Notifications
            </h2>
            <button type="button" className="icon-button" aria-label="Close notifications" onClick={() => close()}>
              <LuX aria-hidden="true" />
            </button>
          </div>
          <p className="bell__summary muted">{unread > 0 ? `${formatCount(unread)} unread` : 'Nothing unread.'}</p>
          {notifications.isPending && <p className="muted">Loading…</p>}
          {notifications.error && (
            <p className="form-error" role="alert">
              {notifications.error.message}
            </p>
          )}
          {notifications.data && list.length === 0 && <p className="muted">No notifications.</p>}
          {list.length > 0 && (
            <ul className="bell__list">
              {list.map((item) => {
                const severity = SEVERITY[item.severity] ?? SEVERITY.info
                const Icon = severity.icon
                const path = appPath(item.link)
                return (
                  <li key={item.id} className={`bell__item bell__item--${item.severity in SEVERITY ? item.severity : 'info'}${item.readAt ? '' : ' is-unread'}`}>
                    <Icon aria-hidden="true" className="bell__icon" />
                    <div className="bell__text">
                      <p>
                        <span className="visually-hidden">{`${severity.label}${item.readAt ? '' : ', unread'}: `}</span>
                        {path ? (
                          <Link
                            to={path}
                            onClick={() => {
                              // Opening it counts as reading it.
                              if (!item.readAt) markRead.mutate(item)
                              close({ restoreFocus: false })
                            }}
                          >
                            {item.title}
                          </Link>
                        ) : (
                          <strong>{item.title}</strong>
                        )}
                      </p>
                      {item.body && <p className="bell__body">{item.body}</p>}
                      <p className="bell__meta muted">
                        {formatDate(item.createdAt)}
                        {!item.readAt && (
                          <>
                            {' · '}
                            <button type="button" className="link-button" aria-label={`Mark "${item.title}" as read`} disabled={markRead.isPending} onClick={() => markRead.mutate(item)}>
                              Mark read
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {unread > 0 && (
            <button type="button" className="btn btn--outline btn--sm btn--full" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
              {markAll.isPending ? 'Working…' : 'Mark all as read'}
            </button>
          )}
          <p role="status" className="visually-hidden">
            {message}
          </p>
        </div>
      )}
    </div>
  )
}

export default NotificationsBell
