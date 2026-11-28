import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { photoKind, shrinkPhoto } from '../utils/shrinkPhoto'

/**
 * Phase 22: the photos a shopper adds to a review, before they are sent.
 *
 * `add(files)` checks a whole selection before keeping any of it: the count
 * (at most `max` in all), the type (from the file's bytes), and the size
 * after shrinking (at most `maxMegabytes`). A selection with a problem is
 * refused as a whole, with one message naming the problem. Each kept photo
 * gets a preview address (an object URL), released again when the photo is
 * removed or the form goes away.
 *
 * Returns { photos: [{ key, file, previewUrl, name }], add, remove, error, preparing }.
 */
export function useReviewPhotos({ max, maxMegabytes }) {
  const { t } = useTranslation('catalog')
  const [photos, setPhotos] = useState([])
  const [error, setError] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const nextKey = useRef(1)
  // Every preview address still in use (the Set itself never changes, so the clean-up below sees all of them).
  const previewUrls = useRef(new Set())
  const mounted = useRef(false)

  useEffect(() => {
    const urls = previewUrls.current
    mounted.current = true
    return () => {
      mounted.current = false
      for (const url of urls) URL.revokeObjectURL?.(url)
      urls.clear()
    }
  }, [])

  async function add(fileList) {
    const files = [...(fileList ?? [])]
    if (files.length === 0 || preparing) return
    if (photos.length + files.length > max) {
      setError(t('reviewForm.photosTooMany', { max }))
      return
    }
    setError(null)
    setPreparing(true)
    const ready = []
    let problem = null
    for (const file of files) {
      const kind = await photoKind(file)
      if (!kind) {
        problem = t('reviewForm.photoWrongType', { name: file.name })
        break
      }
      const photo = await shrinkPhoto(file, kind)
      if (photo.size > maxMegabytes * 1024 * 1024) {
        problem = t('reviewForm.photoTooLarge', { name: file.name, size: maxMegabytes })
        break
      }
      ready.push({ file: photo, name: file.name })
    }
    if (!mounted.current) return
    setPreparing(false)
    if (problem) {
      setError(problem)
      return
    }
    const added = ready.map(({ file, name }) => {
      const previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
      if (previewUrl) previewUrls.current.add(previewUrl)
      return { key: nextKey.current++, file, previewUrl, name }
    })
    setPhotos((current) => [...current, ...added].slice(0, max))
  }

  function remove(key) {
    const photo = photos.find((candidate) => candidate.key === key)
    if (photo?.previewUrl) {
      URL.revokeObjectURL?.(photo.previewUrl)
      previewUrls.current.delete(photo.previewUrl)
    }
    setError(null)
    setPhotos((current) => current.filter((candidate) => candidate.key !== key))
  }

  return { photos, add, remove, error, preparing }
}
