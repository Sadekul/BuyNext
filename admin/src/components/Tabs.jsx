import { useId, useRef } from 'react'

/**
 * Tabs (WAI-ARIA tabs pattern): a tablist of buttons, arrow keys, Home and
 * End move between them (and select), and only the selected panel is shown.
 * `tabs` = [{ id, label }]; `children(id)` renders the selected panel's content.
 */
function Tabs({ label, tabs, selected, onSelect, children }) {
  const baseId = useId()
  const refs = useRef({})

  function onKeyDown(event) {
    const index = tabs.findIndex((tab) => tab.id === selected)
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const tab = tabs[(next + tabs.length) % tabs.length]
    onSelect(tab.id)
    refs.current[tab.id]?.focus()
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[tab.id] = node
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === selected}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab.id === selected ? 0 : -1}
            className="tabs__tab"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel-${selected}`} aria-labelledby={`${baseId}-tab-${selected}`} className="tabs__panel" tabIndex={0}>
        {children(selected)}
      </div>
    </div>
  )
}

export default Tabs
