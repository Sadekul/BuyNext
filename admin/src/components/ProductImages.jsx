import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LuArrowDown, LuArrowUp, LuImagePlus, LuTrash2, LuUpload } from 'react-icons/lu'
import { adminKeys, deleteProductImage, reorderProductImages, updateProductImage, uploadProductImages } from '../api/admin'
import { actionErrorMessage } from '../utils/permissions'
import ConfirmDialog from './ConfirmDialog'

// The server's rules (docs/backend/PHASE5_CONTRACT.md §2); it checks the real file contents again.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PER_UPLOAD = 10
const MAX_IMAGES = 12

const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Which chosen files can't be uploaded, and why (empty: all fine). */
function checkFiles(files, existing) {
  const problems = []
  if (files.length > MAX_PER_UPLOAD) problems.push(`Choose up to ${MAX_PER_UPLOAD} files at a time.`)
  if (existing + files.length > MAX_IMAGES) problems.push(`A product can have at most ${MAX_IMAGES} images; it has ${existing}.`)
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type)) problems.push(`${file.name}: use a JPEG, PNG, or WebP image.`)
    else if (file.size > MAX_IMAGE_BYTES) problems.push(`${file.name} is ${size(file.size)}; the limit is 5 MB.`)
  }
  return problems
}

/**
 * Product form → Images: upload several files (previewed first), alt text,
 * order (the first image is the product's main picture), delete. Changes are
 * saved right away, separately from the product's other fields.
 */
function ProductImages({ productId, images, editable }) {
  const queryClient = useQueryClient()
  const inputId = useId()
  const fileInput = useRef(null)
  const buttons = useRef(new Map())
  const [files, setFiles] = useState([])
  const [order, setOrder] = useState(null) // ids after a move, until the server's answer is back
  const [alts, setAlts] = useState({})
  const [toDelete, setToDelete] = useState(null)
  const [message, setMessage] = useState(null) // { tone, text }

  const shown = order ? order.map((id) => images.find((image) => image.id === id)).filter(Boolean) : images
  const problems = checkFiles(files, images.length)

  // Previews of the chosen files (object URLs, released when replaced).
  const previews = useMemo(() => (typeof URL.createObjectURL === 'function' ? files.map((file) => URL.createObjectURL(file)) : []), [files])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.product(productId) })
  const fail = (error) => setMessage({ tone: 'error', text: actionErrorMessage(error) })

  const upload = useMutation({
    mutationFn: () => uploadProductImages(productId, files),
    onSuccess: async () => {
      const count = files.length
      setFiles([])
      if (fileInput.current) fileInput.current.value = ''
      await refresh()
      setMessage({ tone: 'success', text: `${count === 1 ? '1 image' : `${count} images`} uploaded.` })
    },
    onError: fail,
  })

  const saveAlt = useMutation({
    mutationFn: ({ image, alt }) => updateProductImage(productId, image.id, alt),
    onSuccess: async (_, { image, position }) => {
      await refresh()
      setAlts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== image.id)))
      setMessage({ tone: 'success', text: `Description of image ${position} saved.` })
    },
    onError: fail,
  })

  const remove = useMutation({
    mutationFn: (image) => deleteProductImage(productId, image.id),
    onSuccess: async (_, image) => {
      setToDelete(null)
      await refresh()
      setMessage({ tone: 'success', text: `Image ${image.position} deleted.` })
    },
    onError: (error) => {
      setToDelete(null)
      fail(error)
    },
  })

  const reorder = useMutation({
    mutationFn: (ids) => reorderProductImages(productId, ids),
    onSettled: async () => {
      await refresh()
      setOrder(null)
    },
    onError: fail,
  })

  function move(index, step) {
    const ids = shown.map((image) => image.id)
    const [id] = ids.splice(index, 1)
    const target = index + step
    ids.splice(target, 0, id)
    setOrder(ids)
    reorder.mutate(ids)
    setMessage({ tone: 'success', text: `Image moved to position ${target + 1} of ${ids.length}.${target === 0 ? ' It is now the main image.' : ''}` })
    const atEnd = step < 0 ? target === 0 : target === ids.length - 1
    requestAnimationFrame(() => buttons.current.get(`${id}-${(step < 0) !== atEnd ? 'up' : 'down'}`)?.focus())
  }

  return (
    <section className="panel panel--padded product-section" aria-labelledby="images-title">
      <h2 id="images-title" className="panel__title">
        Images
      </h2>
      <p className="field__hint">
        JPEG, PNG, or WebP, up to 5 MB each, at most {MAX_IMAGES} per product. The first image is the main picture in the store.
      </p>
      <div role={message?.tone === 'error' ? 'alert' : 'status'}>{message && <p className={message.tone === 'error' ? 'form-error' : 'notice notice--success'}>{message.text}</p>}</div>

      {shown.length === 0 ? (
        <p className="muted">No images uploaded yet.</p>
      ) : (
        <ol className="image-list">
          {shown.map((image, index) => {
            const alt = alts[image.id] ?? image.alt
            const altId = `${inputId}-alt-${image.id}`
            return (
              <li key={image.id} className="image-item">
                {/* Phase 9 §2: the 320 px copy is plenty for this 96 px preview; the original when there's none. */}
                <img src={image.variants?.['320'] ?? image.url} alt={image.alt} width="96" height="96" loading="lazy" />
                <div className="image-item__body">
                  <p className="image-item__title">
                    Image {index + 1}
                    {index === 0 && <span className="status status--info">Main image</span>}
                  </p>
                  {image.variants && (
                    <p className="field__hint">
                      {Object.keys(image.variants).length > 0
                        ? `Resized copies for faster pages: ${Object.keys(image.variants)
                            .map((width) => `${width} px`)
                            .join(', ')}.`
                        : image.isUpload
                          ? 'No resized copies: the original is used everywhere.'
                          : 'External address: shown as it is.'}
                    </p>
                  )}
                  {editable ? (
                    <form
                      className="image-item__alt"
                      onSubmit={(event) => {
                        event.preventDefault()
                        saveAlt.mutate({ image, alt: alt.trim(), position: index + 1 })
                      }}
                    >
                      <label htmlFor={altId}>Alt text for image {index + 1}</label>
                      <input id={altId} value={alt ?? ''} maxLength={190} placeholder="What the image shows" onChange={(event) => setAlts({ ...alts, [image.id]: event.target.value })} />
                      <button type="submit" className="btn btn--outline btn--sm" disabled={alt === image.alt || saveAlt.isPending}>
                        Save
                      </button>
                    </form>
                  ) : (
                    <p className="muted">{image.alt || 'No alt text.'}</p>
                  )}
                </div>
                {editable && (
                  <div className="image-item__tools">
                    <button
                      type="button"
                      ref={(node) => buttons.current.set(`${image.id}-up`, node)}
                      className="icon-button"
                      aria-label={`Move image ${index + 1} up`}
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => move(index, -1)}
                    >
                      <LuArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      ref={(node) => buttons.current.set(`${image.id}-down`, node)}
                      className="icon-button"
                      aria-label={`Move image ${index + 1} down`}
                      disabled={index === shown.length - 1 || reorder.isPending}
                      onClick={() => move(index, 1)}
                    >
                      <LuArrowDown aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button icon-button--danger" aria-label={`Delete image ${index + 1}`} onClick={() => setToDelete({ ...image, position: index + 1 })}>
                      <LuTrash2 aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {editable && (
        <div className="image-upload">
          <label htmlFor={inputId} className="image-upload__label">
            <LuImagePlus aria-hidden="true" /> Add images
          </label>
          <input
            id={inputId}
            ref={fileInput}
            type="file"
            multiple
            accept={IMAGE_TYPES.join(',')}
            disabled={images.length >= MAX_IMAGES}
            onChange={(event) => {
              setMessage(null)
              setFiles([...event.target.files])
            }}
          />
          {files.length > 0 && (
            <>
              <ul className="image-previews" aria-label="Chosen images">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    {previews[index] && <img src={previews[index]} alt="" width="64" height="64" />}
                    <span>
                      {file.name} <small className="muted">{size(file.size)}</small>
                    </span>
                  </li>
                ))}
              </ul>
              {problems.length > 0 && (
                <ul className="form-error" role="alert">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              <div className="form__actions">
                <button type="button" className="btn btn--primary btn--sm" disabled={problems.length > 0 || upload.isPending} onClick={() => upload.mutate()}>
                  <LuUpload aria-hidden="true" /> {upload.isPending ? 'Uploading…' : `Upload ${files.length === 1 ? '1 image' : `${files.length} images`}`}
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => {
                    setFiles([])
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={toDelete !== null}
        title={`Delete image ${toDelete?.position ?? ''}?`}
        message="The file is removed from the store. This can't be undone."
        confirmLabel="Delete image"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </section>
  )
}

export default ProductImages
