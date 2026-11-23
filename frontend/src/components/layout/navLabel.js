/** A link's text: its translation key (fixed links, constants/site.js) or the label as given (category names from the API). */
export const linkLabel = (t, link) => (link.labelKey ? t(link.labelKey) : link.label)
