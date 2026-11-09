# BuyNest learning log

## Phase 1: Environment and project setup

- What Vite is: an ES-module dev server with HMR plus a production bundler
- How React boots: `index.html` → `<script type="module" src="/src/main.jsx">` → `createRoot().render(<App />)`
- ES modules: default vs named `import`/`export`
- npm scripts, `package.json`, and the lockfile
- ESLint flat config: core rules, Rules of Hooks, react-refresh
- `VITE_` environment variables and why they are public
- `.gitignore`, and keeping `.env.local` out of Git

## Phase 2: Components and frontend template

- JSX rules: single root or fragment, `className`, `{}` expressions, self-closing tags
- Functional components, plus class equivalents in `src/learning/`
- Composition: `MobileNavigation` reuses `Modal` and `SearchBar`; `ProductSection` = `SectionHeading` + `ProductGrid`
- Props: destructuring, defaults, objects and arrays as props, and function props (`onAddToCart`, `onClose`, `onRetry`)
- `children` props: `EmptyState` actions, `Modal` body
- Conditional rendering: `&&`, ternaries, early `return`
- Lists with `map()` and stable keys (`product.id`, `slug`); when index keys are acceptable
- Events: `onClick`, `onChange`, `onSubmit` + `preventDefault()`
- State introduced where needed: `useState` (menu, newsletter, toast); state lives in the closest common parent
- `useEffect` with cleanup (`Toast` timer), `useRef` (`Modal`'s dialog), `useId` (unique form ids), `useCallback` (stable `onDismiss`)
- React Router basics: `BrowserRouter`, nested `Route`s with `Outlet`, `Link` vs `NavLink`, `useNavigate`
- How React updates the DOM: render → compare with the previous output → patch only what changed

## Phase 3: External API integration

- REST, JSON, HTTP methods (GET/POST/PUT/PATCH/DELETE) and status codes (200, 201, 400, 404, 429, 5xx)
- `fetch()`: it resolves on 4xx/5xx, so we check `response.ok`; it rejects only on network failure or abort
- Promises, `async`/`await`, `try`/`catch`, and response parsing with `response.json()`
- Request headers (`Accept`, `Content-Type`), query parameters with `URLSearchParams`, and where auth headers will go
- CORS: DummyJSON returns `Access-Control-Allow-Origin`, so the browser allows our requests
- `AbortController` and `AbortSignal.timeout`/`AbortSignal.any`: cancel stale requests and enforce timeouts
- A service layer + an adapter (normalization) layer, so components don't depend on one API's shape
- Custom hooks (`useFetch`, `useProductList`): loading, error, empty, retry, and load-more states
- `useEffect` cleanup to prevent stale responses from overwriting newer ones; StrictMode's double effect in development
- `useEffectEvent`: read the latest values in an effect without making them dependencies
- Event-driven fetching (playground buttons, "load more") vs effect-driven fetching (data a page needs to show)
- Server-side search, category, sorting, and pagination; URL search params as state (`useSearchParams`)
- Fetch vs Axios: Axios adds `baseURL`, automatic JSON, throwing on 4xx/5xx, timeouts, and interceptors

## Phase 4: Product listing and catalog

- Server-side vs client-side filtering, and why filters must see the full set
- Derived state: compute filtered/sorted/paginated lists during render instead of storing them
- Controlled inputs for every filter (number, radio, checkbox) owned by one parent
- Immutable updates with spread, `filter`, and `toSorted` (never `sort` on state)
- Resetting a subtree's state with the `key` prop
- Component communication through function props (filters, sort, view, pagination, quick view)
- Accessible controls: `fieldset`/`legend`, `aria-pressed`, `aria-expanded`, `aria-current="page"`

## Phase 5: Product details page

- Dynamic routes (`:productId`) and `useParams` (params are strings — validate them)
- Route-based data fetching keyed by the URL; 404 handling with `ApiError.status`
- Component reuse across same-route navigation, and resetting state with `key`
- `Link` vs `NavLink` vs `useNavigate` (`navigate(-1)`, `location.key`)
- React 19 `<title>` in components for per-page document titles
- Real business rules from data (minimum order quantity vs stock); not inventing variants

## Phase 6: Shopping cart

- Lifting state, prop drilling, and when to switch to Context
- Context API (`createContext`, React 19 `<Context value>`, `useContext` in a guarded custom hook)
- `useReducer` with action types; a pure reducer that enforces all quantity rules
- Immutable updates for nested arrays/objects (`map`, `filter`, spread)
- Lazy state initialization, `localStorage` sync in an effect, validation of stored data, cross-tab `storage` events
- `useMemo`/`useCallback` to keep a context value stable
- Money in integer cents; explicit shipping and coupon rules; why the backend must re-validate

## Phase 7: Wishlist

- Extracting reusable hooks (`usePersistentReducer`, `useProductRefresh`): hooks share logic, not state
- Context-connected components (`WishlistButton`) vs function props
- Provider nesting order when one provider uses another
- Keeping reducers pure (timestamps created in handlers, passed in actions)
- Preventing duplicates in the reducer and when loading from storage

## Phase 8: Search, filtering, and sorting

- Debouncing with `setTimeout` + effect cleanup (`useDebouncedValue`); debounce vs throttle
- Client-side vs server-side searching
- URL search params as the single source of truth (`replace` vs push history entries; validating URL input)
- `useMemo` for expensive derived data and stable object identity; when not to use it
- React Router transitions vs controlled inputs (`useTransitions={false}`)
- Accessible combobox (search suggestions), removable filter chips, mobile filter drawer
