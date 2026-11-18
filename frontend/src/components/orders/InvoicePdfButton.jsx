import { useId } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuDownload } from 'react-icons/lu'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { getInvoicePdf } from '../../services/shopService'
import { saveFile } from '../../services/accountService'

/**
 * "Download PDF" for an invoice (phase 10). The server makes the PDF; this
 * fetches it through the shop service and saves it with the API's file name
 * ("INV-100001.pdf"). Signed-in customers are recognised by their session
 * (renewed once if it expired); a guest passes the order's `email`, the same
 * proof as order tracking. Errors are announced next to the button.
 */
function InvoicePdfButton({ orderNumber, invoiceNumber, email, size = 'md', variant = 'outline' }) {
  const { isAuthenticated, authorizedRequest } = useAuth()
  const errorId = useId()
  const download = useMutation({
    mutationFn: () =>
      isAuthenticated ? authorizedRequest(() => getInvoicePdf(orderNumber, invoiceNumber)) : getInvoicePdf(orderNumber, invoiceNumber, { email }),
    onSuccess: ({ blob, fileName }) => saveFile(blob, fileName),
  })
  // A guest without the order's email can't prove it is theirs: no button.
  if (!isAuthenticated && !email) return null
  const error = download.error?.message ?? null

  return (
    <div className="invoice-pdf">
      {/* The visible words start the accessible name ("Download PDF of invoice INV-…"), so voice control finds it. */}
      <Button
        variant={variant}
        size={size}
        onClick={() => download.mutate()}
        disabled={download.isPending}
        aria-label={download.isPending ? `Preparing PDF of invoice ${invoiceNumber}…` : `Download PDF of invoice ${invoiceNumber}`}
        aria-describedby={error ? errorId : undefined}
      >
        <LuDownload aria-hidden="true" /> {download.isPending ? 'Preparing PDF…' : 'Download PDF'}
      </Button>
      {error && (
        <p id={errorId} className="pay-now__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default InvoicePdfButton
