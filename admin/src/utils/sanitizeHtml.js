/*
 * A live preview of HTML the admin is typing (newsletter campaigns), cleaned
 * with the SAME allow-list as the server (backend/app/Services/HtmlSanitizer.php),
 * so the preview shows what subscribers will get before it's saved.
 *
 * How it stays safe: DOMParser builds an inert document (its scripts never
 * run, its images never load), and the output is rebuilt from scratch, copying
 * only allowed tags and attributes. Nothing typed reaches the page as-is.
 * The server sanitizes again when it saves; that copy is what gets sent.
 */

const ALLOWED = {
  p: [], h2: [], h3: [], h4: [], ul: [], ol: [], li: [],
  strong: [], em: [], blockquote: [], br: [], hr: [],
  a: ['href', 'title'],
  table: [], caption: [], thead: [], tbody: [], tfoot: [], tr: [],
  th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'],
}
// Harmless wrappers: the tag goes, its text stays. Anything else (script, style, iframe, img, form…) goes with its content.
const UNWRAPPED = new Set(['div', 'span', 'section', 'article', 'header', 'footer', 'main', 'b', 'i', 'u', 'small', 'mark', 'sub', 'sup', 'h1', 'h5', 'h6', 'font', 'center', 'code', 'pre', 'dl', 'dt', 'dd', 'figure', 'figcaption'])

export const MAX_HTML_LENGTH = 100_000

/** http, https, mailto, or a relative address (no other scheme, no control characters). */
function isSafeHref(value) {
  const href = value.trim()
  // Control characters ("java\tscript:" tricks): refused outright.
  if ([...href].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return false
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  return scheme === undefined || ['http', 'https', 'mailto'].includes(scheme)
}

function copyChildren(from, to, doc) {
  for (const node of from.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) to.append(doc.createTextNode(node.textContent))
    else if (node.nodeType === Node.ELEMENT_NODE) copyElement(node, to, doc)
    // Comments, processing instructions…: dropped.
  }
}

function copyElement(element, to, doc) {
  const tag = element.localName
  if (UNWRAPPED.has(tag)) return copyChildren(element, to, doc)
  if (!Object.hasOwn(ALLOWED, tag)) return undefined
  const clean = doc.createElement(tag)
  for (const name of ALLOWED[tag]) {
    const value = element.getAttribute(name)
    if (value === null) continue
    if (name === 'href' && !isSafeHref(value)) continue
    clean.setAttribute(name, value)
  }
  if (tag === 'a') clean.setAttribute('rel', 'noopener')
  copyChildren(element, clean, doc)
  to.append(clean)
  return undefined
}

/** The allowed part of `html`, as an HTML string (empty for empty input). */
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return ''
  const source = new DOMParser().parseFromString(html.slice(0, MAX_HTML_LENGTH), 'text/html')
  // A second inert document to build into: nothing here is attached to the page.
  const target = document.implementation.createHTMLDocument('')
  const root = target.createElement('div')
  copyChildren(source.body, root, target)
  return root.innerHTML.trim()
}
