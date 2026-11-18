import { httpRouter } from 'convex/server'
import { auth } from './auth'
import {
  createDailyRecordsHandler,
  createSamplingHandler,
  getHandler,
  ingestReadingsHandler,
  listHandler,
  openApiHandler,
} from './integrations/apiHttp'
import { API_RESOURCES } from './publicApi'
import { download as fileDownload } from './files'

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

// Sensor / IoT ingestion (INT-007), same API keys with scope ingest:write.
http.route({ path: '/ingest/v1/readings', method: 'POST', handler: ingestReadingsHandler })

// Short-lived document downloads (TRACE-005, D-016).
http.route({ path: '/files/download', method: 'GET', handler: fileDownload })

export default http
