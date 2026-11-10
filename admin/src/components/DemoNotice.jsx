import { LuInfo } from 'react-icons/lu'

/** Reminds the shop owner that changes are simulated until the Laravel backend exists. */
function DemoNotice({ children }) {
  return (
    <p className="demo-notice">
      <LuInfo aria-hidden="true" />
      <span>
        {children ??
          'Demo data from DummyJSON: changes are checked and accepted, but not saved, so the store and these lists keep the original values.'}
      </span>
    </p>
  )
}

export default DemoNotice
