import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuDatabaseBackup, LuDownload } from 'react-icons/lu'
import { backupDownloadLink, getBackups, runBackup, securityKeys } from '../api/security'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatBytes, formatDateTime } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'

// The API's reason ("A backup is already running…", "The backup failed: …") is a field error.
const problem = (error) => (error.fieldErrors ? Object.values(error.fieldErrors)[0]?.[0] : null) ?? actionErrorMessage(error)

/** Starts a file download from a short-lived link (same-origin, so the browser keeps this page open). */
function startDownload(url, name) {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

/**
 * System → Backups (phase 9 §3, backups.view, the Owner by default): the
 * latest database backups with size and time, "Back up now", and downloads
 * through a link that works for 5 minutes (each download is audited).
 * Restoring is a documented procedure, not a button.
 */
function BackupsPage() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const backups = useQuery({ queryKey: securityKeys.backups, queryFn: ({ signal }) => getBackups({ signal }) })

  function announce(text, tone = 'success') {
    setNotice({ text, tone })
    requestAnimationFrame(() => noticeRef.current?.focus())
  }

  const backUp = useMutation({
    mutationFn: runBackup,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: securityKeys.backups })
      announce(data?.message ?? (data?.backup?.name ? `Backup ${data.backup.name} is ready.` : 'Backup started.'))
    },
    onError: (error) => announce(problem(error), 'error'),
  })

  const download = useMutation({
    mutationFn: (backup) => backupDownloadLink(backup.name),
    onSuccess: (data, backup) => {
      startDownload(data.url, backup.name)
      announce(`Downloading ${backup.name}. The link works for 5 minutes.`)
    },
    onError: (error) => announce(problem(error), 'error'),
  })

  const list = backups.data?.backups ?? []
  return (
    <>
      <title>Backups | BuyNest Admin</title>
      <PageHeader
        title="Backups"
        description={
          backups.data?.keepDays
            ? `Database backups, made every day at 03:00 (store time) and kept for ${backups.data.keepDays} days.`
            : 'Database backups, made every day at 03:00 (store time).'
        }
        actions={
          <button type="button" className="btn btn--primary" disabled={backUp.isPending} onClick={() => backUp.mutate()}>
            <LuDatabaseBackup aria-hidden="true" /> {backUp.isPending ? 'Backing up…' : 'Back up now'}
          </button>
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      {backups.isPending && <Loading label="Loading backups…" />}
      {backups.error && <ErrorState error={backups.error} onRetry={backups.refetch} />}
      {backups.data && list.length === 0 && <Empty>No backups yet. Use “Back up now” to make the first one.</Empty>}
      {list.length > 0 && (
        <div className="table-wrap" aria-busy={backups.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Database backups, newest first</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Made</th>
                <th scope="col" className="table__number">
                  Size
                </th>
                {list.some((backup) => backup.status) && <th scope="col">Result</th>}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((backup) => (
                <tr key={backup.name}>
                  <th scope="row">
                    <code>{backup.name}</code>
                  </th>
                  <td>{formatDateTime(backup.createdAt)}</td>
                  <td className="table__number">{formatBytes(backup.size)}</td>
                  {list.some((item) => item.status) && (
                    <td>{backup.status && <StatusBadge tone={backup.status === 'failed' ? 'danger' : 'success'} label={backup.status === 'failed' ? 'Failed' : 'Complete'} />}</td>
                  )}
                  <td className="table__actions">
                    {backup.status !== 'failed' && (
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        aria-label={`Download ${backup.name}`}
                        disabled={download.isPending}
                        onClick={() => download.mutate(backup)}
                      >
                        <LuDownload aria-hidden="true" /> Download
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted backups__note">
        Backups contain every customer's personal data: download them only to a safe place. Restoring a backup is done by a developer, following the
        restore steps in the deployment guide.
      </p>
    </>
  )
}

export default BackupsPage
