import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminAuthProvider from './auth/AdminAuthProvider'
import { AdminRoutes } from './routes'

const queryClient = new QueryClient({
  defaultOptions: {
    // Admin data changes underneath you; a short freshness window, and no retry on 4xx.
    queries: { staleTime: 30_000, retry: (count, error) => count < 2 && !(error?.status >= 400 && error?.status < 500) },
    mutations: { retry: false },
  },
})

/** Routes are relative to /admin (BrowserRouter basename in main.jsx); the table is in routes.jsx. */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <AdminRoutes />
      </AdminAuthProvider>
    </QueryClientProvider>
  )
}

export default App
