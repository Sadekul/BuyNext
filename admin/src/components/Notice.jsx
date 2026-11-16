/** A page-level message from useNotice() (utils/marketing.js): status for success, alert for errors. */
function Notice({ notice, noticeRef }) {
  return (
    <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
      {notice && (
        <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
          {notice.text}
        </p>
      )}
    </div>
  )
}

export default Notice
