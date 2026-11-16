// Netlify function for /media/*: uploaded product photos, streamed from the API's storage (server/mediaApi.js).
import { handleMediaRequest } from '../../server/mediaApi.js'

export default handleMediaRequest

export const config = { path: '/media/*' }
