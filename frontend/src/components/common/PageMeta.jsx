import { useEffect, useState } from 'react'
import { SITE } from '../../constants/site'
import { createPageMetaId, removePageMetaLayer, setPageMetaLayer } from '../../utils/pageMeta'

/**
 * A page's title and search/link-preview tags (utils/pageMeta.js):
 *
 *   <PageMeta title="Wireless earbuds" description="…" image={product.thumbnail} type="product" canonicalPath="/products/12" />
 *
 * `title` is the page's own name: the browser tab reads "Wireless earbuds | BuyNest",
 * and link previews show "Wireless earbuds". Everything else is optional and
 * falls back to the site defaults. `noindex` keeps the page out of search
 * results (the "not found" page).
 */
function PageMeta({ title, description, image, type, canonicalPath, noindex = false }) {
  const [id] = useState(createPageMetaId)

  useEffect(() => {
    setPageMetaLayer(id, { title: title ?? null, description, image, type, canonicalPath, noindex })
  }, [id, title, description, image, type, canonicalPath, noindex])

  useEffect(() => () => removePageMetaLayer(id), [id])

  return title ? <title>{`${title} | ${SITE.name}`}</title> : null
}

export default PageMeta
