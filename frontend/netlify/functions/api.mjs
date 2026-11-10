// Netlify function for BuyNest's server-side services (server/api.js):
// the sign-in service and the admin service.
import { handleApiRequest } from '../../server/api.js'

export default handleApiRequest

export const config = { path: ['/api/auth/:action', '/api/admin/*'] }
