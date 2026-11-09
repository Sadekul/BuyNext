# Phase 13 — Testing and debugging

**Goal:** an automated test suite that runs offline in seconds (`npm test`), plus the debugging habits professional React developers use.

## Tools
| Package | Role |
| --- | --- |
| `vitest` | Test runner. Reuses `vite.config.js`, so JSX and imports work exactly like the app |
| `jsdom` | A simulated browser DOM inside Node |
| `@testing-library/react` (+ `/dom`) | Render components; query them **the way users find things**: by role, label, and text |
| `@testing-library/user-event` | Realistic typing, clicking, and keyboard |
| `@testing-library/jest-dom` | Readable assertions: `toBeInTheDocument`, `toBeDisabled`, `toHaveAccessibleDescription` |

```bash
npm test            # run once (CI)
npm run test:watch  # re-run on save
npx vitest run src/reducers   # one folder
```

## Setup (`vite.config.js` → `test`, `src/test/`)
- `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.js']`.
- `env: { VITE_API_BASE_URL: 'https://api.test' }`: tests can never call the real DummyJSON API.
- `setup.js`: jest-dom matchers, cleanup and storage reset after each test, and small stand-ins for browser APIs jsdom lacks (`<dialog>.showModal`, `scrollIntoView`, `scrollTo`).
- `renderWithProviders(ui, { route, path })`: the app's providers (QueryClient without retries, MemoryRouter, auth, cart, wishlist, orders).
- `mockFetch({ 'GET /products/1': { body }, … })`: **API mocking**. Every request is answered from a route table; unknown routes throw, so nothing silently hits the network.
- `fixtures.js`: test data built from the offline snapshot `src/data/sampleProducts.js` (kept since Phase 3 for exactly this).

## What is tested (94 tests, 17 files)
| Required area | Tests |
| --- | --- |
| ProductCard | `components/product/ProductCard.test.jsx`: prices, badges, missing brand, add-to-cart callback, sold out, optional actions, wishlist `aria-pressed`, list layout |
| ProductGrid | `ProductGrid.test.jsx`: items in order, empty state, list layout |
| Shopping cart reducer | `reducers/cartReducer.test.js`: add/merge, stock cap + notice, minimum order, immutability (frozen state), remove/clear, refresh notices, storage sanitizing |
| Cart quantity updates | `cartReducer.test.js` (`it.each` table) + `QuantitySelector.test.jsx` (buttons disabled at limits) |
| Cart totals | `utils/cartTotals.test.js`: cents math, shipping threshold and methods, coupons, unavailable lines |
| Search functionality | `components/common/SearchBar.test.jsx`: **one** request after typing (debounce), no request for 1 character, ↓ + Enter opens the product, submit → `/products?q=` |
| Product filters | `utils/catalog.test.js` (price, rating, brand, availability, combined, sort, paginate) + `utils/catalogParams.test.js` (URL state) + UI test in `ProductListingPage.test.jsx` (checkbox → count, chip removes filter) |
| Loading states | `ProductListingPage.test.jsx` (skeleton → results), `ProtectedRoute.test.jsx` ("Checking your session…") |
| Error states | `ProductListingPage.test.jsx` (500 → "Try again" → success), `ProductDetailsPage.test.jsx` (404, invalid id with no request, 503), `apiClient.test.js`, `ErrorBoundary.test.jsx` |
| Form validation | `utils/validation.test.js`, `schemas/checkoutSchema.test.js` (nested and conditional rules), `pages/LoginPage.test.jsx` (errors after submit, focus, live clearing, server error) |
| Protected route behavior | `routes/ProtectedRoute.test.jsx`: redirect with `state.from`, loader then page, invalid session → signed out |
| Backend adapter | `services/adapters/laravelAdapter.test.js` (contract fixtures) |

### Do the tests catch bugs?
We broke `clampQuantity` on purpose (removed the stock cap). Two tests failed: "caps quantity at the stock" and "setting 99 stores 10". After restoring the code, all passed. A test that can't fail is worthless; try this "mutation" yourself on a function you're unsure about.

## Writing good component tests
1. **Query like a user**, in this order: `getByRole` (with `name`), `getByLabelText`, `getByText`. Avoid CSS selectors and test ids (one test id is used, to read the router location).
2. **`find*` for async** UI (`findByText` waits up to 1 s), `query*` to assert something is **absent**.
3. **`userEvent.setup()`** then `await user.click/type/keyboard`. It fires the same events a person would.
4. Test **behavior, not implementation**: "the error clears when the field becomes valid", not "setState was called".
5. Unit-test pure logic heavily (fast and precise); integration-test the important flows.

## Unit vs component vs integration tests
| Kind | BuyNest example | Speed | Confidence |
| --- | --- | --- | --- |
| Unit | `cartReducer`, `filterProducts`, `checkoutSchema` | ms | One function |
| Component | `ProductCard`, `QuantitySelector` | ~10 ms | One piece of UI |
| Integration | `ProductListingPage` with mocked fetch, router, query cache, and filters | ~100 ms | A whole feature |
| End-to-end | The Playwright browser scripts used during development | seconds | The real app and API |

## Why not test against the live API?
DummyJSON's data, rate limits, and availability can change; a test that fails because a product price changed teaches nothing and blocks deployments. Mock the network in unit/integration tests; keep a few end-to-end smoke checks for the real API.

## Basic accessibility testing
- **Role-based queries are accessibility checks**: `getByRole('button', { name: 'Sign in' })` fails if the button has no accessible name.
- `toHaveAccessibleDescription` verifies errors are linked with `aria-describedby`; `toHaveAttribute('aria-pressed' | 'aria-invalid')` checks state.
- Manual checks: keyboard only (Tab, Shift+Tab, Enter, Space, Esc), the skip link, visible focus, 200% zoom.
- Tools: Chrome DevTools → Lighthouse → Accessibility; axe DevTools extension; the Accessibility pane in Elements.

## Debugging toolkit
| Problem | Tool |
| --- | --- |
| A value is wrong | `console.log({ products, filters })`, or `debugger;` / breakpoints in **Sources** (pause, inspect, step) |
| A request fails or returns odd data | **Network** tab: status, request URL and params, response body, timing; right-click → "Copy as cURL" to replay |
| A component shows the wrong thing | **React DevTools → Components**: props, state, hooks, context; edit values live |
| Too many renders / slow UI | **React DevTools → Profiler** with "Highlight updates" |
| Stored data looks wrong | **Application** tab → Local/Session Storage (`buynest.*` keys) |
| A test fails mysteriously | `screen.debug()` prints the current DOM; `screen.logTestingPlaygroundURL()` suggests better queries |
| Lint warnings | `npm run lint`, especially the React Hooks rules (they caught several real issues in this project) |

Remove `console.log` and `debugger` before committing (Phase 14 checks).

## Practice
Write tests for `WishlistPage`: render with two saved items in `localStorage`, mock `GET /products`, click "Move to cart", and assert the item leaves the wishlist and the cart count becomes the minimum order quantity.

## Interview questions
1. **Why prefer `getByRole` over `getByTestId`?** It tests what users and assistive technology experience and fails on accessibility regressions.
2. **`getBy` vs `queryBy` vs `findBy`?** `getBy` throws if missing; `queryBy` returns `null` (to assert absence); `findBy` waits for async UI.
3. **How do you test code that fetches data?** Mock the network boundary (`fetch` or MSW) with deterministic responses; assert on what the user sees in loading, success, and error states.
4. **What makes a test brittle?** Coupling to implementation details (class names, internal state, exact call counts that don't matter, live data).
5. **How do you know a test is useful?** It fails when the behavior breaks (try mutating the code) and passes after any refactor that keeps the behavior.
