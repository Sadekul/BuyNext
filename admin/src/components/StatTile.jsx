/**
 * One headline number. The label names it; `note` adds context in muted ink.
 * No trend arrows: the demo data has no history to compare against.
 */
function StatTile({ label, value, note, hero = false }) {
  return (
    <div className={`stat${hero ? ' stat--hero' : ''}`}>
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
      {note && <dd className="stat__note">{note}</dd>}
    </div>
  )
}

export default StatTile
