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
