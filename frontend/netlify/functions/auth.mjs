// Netlify function for /api/auth/<action>: the BuyNest sign-in service (server/authBff.js).
import { handleAuthRequest } from '../../server/authBff.js'

export default handleAuthRequest

export const config = { path: '/api/auth/:action' }
