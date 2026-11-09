import './AnnouncementBar.css'

/** Thin promo strip above the header. Shows one message on mobile, all on desktop. */
function AnnouncementBar({ messages }) {
  if (messages.length === 0) return null

  return (
    <aside className="announcement-bar" aria-label="Store announcements">
      <ul className="announcement-bar__list container">
        {messages.map((message) => (
          <li key={message} className="announcement-bar__item">
            {message}
          </li>
        ))}
      </ul>
    </aside>
  )
}

export default AnnouncementBar
