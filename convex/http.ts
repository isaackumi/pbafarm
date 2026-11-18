import { httpRouter } from 'convex/server'
import { auth } from './auth'
import {
  createDailyRecordsHandler,
  createSamplingHandler,
  getHandler,
  listHandler,
  openApiHandler,
} from './integrations/apiHttp'
import { API_RESOURCES } from './publicApi'

const http = httpRouter()

auth.addHttpRoutes(http)

// Public API v1 (INT-004, doc 09 §8). Contract: /api/v1/openapi.json.
http.route({ path: '/api/v1/openapi.json', method: 'GET', handler: openApiHandler })
for (const resource of API_RESOURCES) {
  http.route({ path: `/api/v1/${resource}`, method: 'GET', handler: listHandler(resource) })
  http.route({ pathPrefix: `/api/v1/${resource}/`, method: 'GET', handler: getHandler(resource) })
}
http.route({ path: '/api/v1/daily-records', method: 'POST', handler: createDailyRecordsHandler })
http.route({ path: '/api/v1/sampling', method: 'POST', handler: createSamplingHandler })

export default http
