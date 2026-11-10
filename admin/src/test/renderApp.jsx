import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import AdminAuthProvider from '../auth/AdminAuthProvider'
import { AdminRoutes } from '../routes'

/** The admin app's real providers and routes (routes.jsx), at `route`. */
export function renderApp(route = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AdminAuthProvider>
          <AdminRoutes />
        </AdminAuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
