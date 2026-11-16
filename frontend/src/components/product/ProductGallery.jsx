import { useState } from 'react'
import { cn } from '../../utils/classNames'
import './ProductGallery.css'

/**
 * Main image + clickable thumbnails. The selected index is local state;
 * the details page gives this component a `key` per product, so the
 * selection resets when you navigate to a different product.
 */
function ProductGallery({ images, title, alts }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedImage = images[selectedIndex]
  // The shop's own description of the image (BuyNest's API) when it has one.
  const position = `image ${selectedIndex + 1} of ${images.length}`
  const alt = alts?.[selectedIndex] ? (images.length > 1 ? `${alts[selectedIndex]} (${position})` : alts[selectedIndex]) : `${title}, ${position}`

  return (
    <div className="gallery">
      <div className="gallery__main">
        <img
          src={selectedImage}
          alt={alt}
          width="600"
          height="600"
          fetchPriority="high"
        />
      </div>

      {images.length > 1 && (
        <ul className="gallery__thumbs" aria-label="Product images">
          {images.map((image, index) => (
            <li key={image}>
              <button
                type="button"
                className={cn('gallery__thumb', index === selectedIndex && 'gallery__thumb--active')}
                onClick={() => setSelectedIndex(index)}
                aria-pressed={index === selectedIndex}
                aria-label={`Show image ${index + 1} of ${images.length}`}
              >
                <img src={image} alt="" loading="lazy" width="80" height="80" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProductGallery
