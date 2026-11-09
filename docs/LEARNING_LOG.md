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

## Phase 9: User registration and authentication

- Authentication vs authorization; session cookies vs bearer tokens
- Access and refresh tokens; refresh-and-retry on 401; expired sessions
- 401 vs 403 (and DummyJSON's 400 for bad credentials)
- Protected and guest-only layout routes with `<Navigate>` and `state.from`
- Client-side validation with touched/submitted state, focus management, `aria-invalid`/`aria-describedby`; why the server must validate too
- Allow-listing user fields to keep sensitive data out of state and storage
- Cross-tab sign-out with the `storage` event (and the remove-then-set bug it exposed)
- Production plan: Laravel Sanctum with HttpOnly, Secure, SameSite cookies + CSRF

## Phase 10: Checkout and order management

- React Hook Form (`register`, `handleSubmit`, `useWatch`, `setError('root.…')`, `isSubmitting`, focus on error)
- Zod schemas: formats, enums, nested objects, conditional rules with `superRefine`; `zodResolver`
- Controlled vs uncontrolled inputs; validation timing (on submit, then on change) and why on-blur errors can swallow clicks
- Nested forms are invalid HTML; the `form` attribute on a submit button
- Server-side verification of prices, stock, discounts, shipping, taxes, and totals; never handling card data
- Order history scoped to the signed-in customer (and IDOR on the server)

## Phase 11: Advanced React

- Every hook mapped to real code, including `useEffectEvent` and `useSyncExternalStore`
- Class lifecycle methods vs hooks; error boundaries (`getDerivedStateFromError`, `componentDidCatch`, reset by `key`)
- Controlled vs uncontrolled components; refs for DOM access only
- `React.memo` with stable props, `useMemo` vs `useCallback`, when not to optimize
- `React.lazy` + `Suspense` route code splitting; lazy images and `fetchPriority`
- When list virtualization is (and isn't) needed; React DevTools and the Profiler
- TanStack Query: query keys/options, caching, `isPending` vs `isFetching`, invalidation, background refetching, mutations, optimistic updates with rollback, retry policy
- Server state vs client state

## Phase 12: Admin backend integration (frontend side)

- Provider + adapter (anti-corruption) layer; switching backends with `VITE_API_PROVIDER`
- Designing a REST contract: envelopes, pagination meta, error format, decimal-string money
- Parallel requests with `Promise.all` for paginated "fetch all" scopes
- Sanctum SPA auth: `credentials: 'include'`, CSRF via `XSRF-TOKEN` → `X-XSRF-TOKEN`, 419
- Mapping server 422 validation errors onto form fields
- Admin → API → MySQL → storefront flow; backend-enforced permissions; Shopify/Magento public vs private APIs

## Phase 13: Testing and debugging

- Vitest + jsdom + React Testing Library + user-event + jest-dom setup
- API mocking at the `fetch` boundary; fixtures from an offline data snapshot
- Unit (reducers, utils, schemas, API client, adapter), component, and integration tests
- Role/label queries, `find*` for async UI, testing behavior instead of implementation
- Loading, error, empty, validation, and protected-route tests; basic accessibility assertions
- Proving tests catch bugs by breaking code on purpose
- Debugging: console, breakpoints, Network tab, React DevTools, Profiler, storage, `screen.debug()`

## Phase 14: Deployment

- Production build vs dev server; `npm run preview`
- Build-time environment variables and dead-code elimination (learning lab excluded)
- SPA fallback routing (Vercel rewrites, Netlify `_redirects`, Nginx `try_files`)
- Asset hashing and caching headers; basic security headers
- Automated accessibility audit with axe-core (label-in-name, heading order)
- Release checklist
