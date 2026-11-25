import BanglaField from './BanglaField'
import Field from './Field'
import { COUPON_CODE_MAX, TOP_BAR_MESSAGE_MAX } from '../utils/homeTopBar'

/**
 * Phase 17 §2 (docs/backend/PHASE17_CONTRACT.md): "Top promo strip", the slim
 * line above the store's header with a message and, optionally, a coupon code
 * shoppers can copy. The page keeps the state and saves it with the home page;
 * errors come in by path ("topBar.couponCode"). A hidden strip keeps its texts.
 */
function TopBarEditor({ bar, setBar, err }) {
  const set = (field) => (value) => setBar((current) => ({ ...current, [field]: value }))
  return (
    <section className="panel" aria-labelledby="top-bar-title">
      <h2 id="top-bar-title" className="panel__title">
        Top promo strip
      </h2>
      <label className="checkbox">
        <input type="checkbox" checked={bar.enabled} aria-describedby="top-bar-enabled-hint" onChange={(event) => set('enabled')(event.target.checked)} />
        Show the top promo strip
      </label>
      <p id="top-bar-enabled-hint" className="field__hint">
        A short line above the store’s header, on every page except checkout. Shoppers can dismiss it. Hidden, its texts are kept for later.
      </p>
      {err('topBar.enabled') && <p className="field__error">{err('topBar.enabled')}</p>}
      <Field label="Message" error={err('topBar.message')} hint={`Up to ${TOP_BAR_MESSAGE_MAX} characters, for example “Free delivery on orders over ৳999”.`}>
        {(a11y) => <input {...a11y} value={bar.message} maxLength={TOP_BAR_MESSAGE_MAX} onChange={(event) => set('message')(event.target.value)} />}
      </Field>
      <BanglaField label="Message in Bangla" value={bar.messageBn} english={bar.message} onChange={set('messageBn')} maxLength={TOP_BAR_MESSAGE_MAX} error={err('topBar.messageBn')} />
      <Field
        label="Coupon code (optional)"
        error={err('topBar.couponCode')}
        hint="Shown next to the message with a Copy button, only while the coupon is active. Saving checks that the code is an active coupon."
      >
        {(a11y) => (
          <input
            {...a11y}
            value={bar.couponCode}
            maxLength={COUPON_CODE_MAX}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => set('couponCode')(event.target.value.toUpperCase())}
          />
        )}
      </Field>
    </section>
  )
}

export default TopBarEditor
