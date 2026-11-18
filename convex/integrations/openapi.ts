/**
 * OpenAPI 3.1 description of /api/v1, served at /api/v1/openapi.json.
 * Keep in step with convex/integrations/apiHttp.ts and convex/publicApi.ts
 * (a test checks every route is described).
 */
import { API_SCOPES } from './apiScopes'
import { SENSOR_PARAMETERS } from './sensorLogic'

const str = { type: 'string' }
const num = { type: 'number' }
const int = { type: 'integer' }
const date = { type: 'string', format: 'date' }
const nullable = (s: Record<string, unknown>) => ({ ...s, type: [s.type as string, 'null'] })

const schemas = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: { type: 'object', required: ['code', 'message'], properties: { code: str, message: str } },
    },
  },
  Cage: {
    type: 'object',
    properties: {
      id: str, name: str, code: nullable(str), status: str, siteId: nullable(str), species: nullable(str),
      stockingDate: nullable(date), initialCount: nullable(int), currentCount: nullable(int),
      currentAbwG: nullable(num), capacity: nullable(num), batchId: nullable(str), updatedAt: nullable(str),
    },
  },
  DailyRecord: {
    type: 'object',
    properties: {
      id: str, cageId: str, date, feedKg: num, feedTypeId: nullable(str), feedType: nullable(str),
      feedCost: num, mortality: int, mortalityCause: nullable(str), dissolvedOxygen: nullable(num),
      temperatureC: nullable(num), secchiCm: nullable(num), notes: nullable(str), siteId: nullable(str),
      batchId: nullable(str), createdAt: str,
    },
  },
  Sampling: {
    type: 'object',
    properties: {
      id: str, cageId: str, date, batchCode: str, averageBodyWeightG: num, fishCount: int,
      totalWeightG: num, dissolvedOxygen: nullable(num), temperatureC: nullable(num),
      secchiCm: nullable(num), siteId: nullable(str), batchId: nullable(str), createdAt: str,
    },
  },
  Harvest: {
    type: 'object',
    properties: {
      id: str, cageId: str, harvestDate: date, harvestType: { enum: ['complete', 'partial'] },
      status: str, totalWeightKg: num, estimatedCount: int, averageBodyWeightG: num, fcr: num,
      siteId: nullable(str), batchId: nullable(str), createdAt: str,
    },
  },
  FeedStock: {
    type: 'object',
    properties: {
      id: str, name: str, currentStockKg: num, minimumStockKg: num, low: { type: 'boolean' },
      bagSizeKg: nullable(num), pricePerKg: num, active: { type: 'boolean' }, updatedAt: nullable(str),
    },
  },
  Sale: {
    type: 'object',
    properties: {
      id: str, saleDate: date, harvestId: nullable(str), cageId: nullable(str), customerId: nullable(str),
      customerName: nullable(str), weightKg: num, pricePerKg: num, totalAmount: num,
      paymentStatus: nullable(str), siteId: nullable(str), createdAt: str,
    },
  },
  DailyRecordsInput: {
    type: 'object',
    required: ['date', 'records'],
    properties: {
      date,
      records: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object',
          required: ['cageId', 'feedKg', 'mortality'],
          properties: {
            cageId: str, feedKg: { ...num, minimum: 0 }, feedTypeId: { ...str, description: 'Required when feedKg > 0' },
            mortality: { ...int, minimum: 0 }, mortalityCause: str, notes: str, dissolvedOxygen: num, temperatureC: num,
          },
        },
      },
    },
  },
  SamplingInput: {
    type: 'object',
    required: ['date', 'records'],
    properties: {
      date,
      records: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object',
          required: ['cageId', 'fishCount', 'totalWeightG'],
          properties: {
            cageId: str, fishCount: { ...int, minimum: 1 }, totalWeightG: { ...num, exclusiveMinimum: 0 },
            batchCode: str, dissolvedOxygen: num, temperatureC: num, secchiCm: num,
          },
        },
      },
    },
  },
}

const errors = {
  '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '401': { description: 'Missing, invalid, expired or revoked key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '403': { description: 'Key lacks the scope, or the organization is not active', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '429': { description: 'Rate limited; see Retry-After', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
}

const listParams = (dated: boolean) => [
  { name: 'limit', in: 'query', schema: { ...int, minimum: 1, maximum: 200, default: 50 } },
  { name: 'cursor', in: 'query', schema: str, description: 'nextCursor from the previous page' },
  ...(dated
    ? [
        { name: 'from', in: 'query', schema: date, description: 'Earliest date, inclusive' },
        { name: 'to', in: 'query', schema: date, description: 'Latest date, inclusive' },
      ]
    : []),
]

export const API_ROUTES: { path: string; resource: string; schema: string; scope: string; dated: boolean; summary: string }[] = [
  { path: '/api/v1/cages', resource: 'cages', schema: 'Cage', scope: 'cages:read', dated: false, summary: 'Cages' },
  { path: '/api/v1/daily-records', resource: 'daily-records', schema: 'DailyRecord', scope: 'daily:read', dated: true, summary: 'Daily records, newest first' },
  { path: '/api/v1/sampling', resource: 'sampling', schema: 'Sampling', scope: 'sampling:read', dated: true, summary: 'Sampling (ABW), newest first' },
  { path: '/api/v1/harvests', resource: 'harvests', schema: 'Harvest', scope: 'harvest:read', dated: true, summary: 'Harvests, newest first' },
  { path: '/api/v1/feed-stock', resource: 'feed-stock', schema: 'FeedStock', scope: 'inventory:read', dated: false, summary: 'Feed types and stock on hand' },
  { path: '/api/v1/sales', resource: 'sales', schema: 'Sale', scope: 'sales:read', dated: true, summary: 'Sales, newest first' },
]

function writeOp(summary: string, scope: string, input: string, output: string) {
  return {
    summary,
    description: `Scope \`${scope}\`. All lines are saved or none. Requires an Idempotency-Key: a retry with the same key and body returns the first response (header Idempotent-Replayed: true); the same key with another body is refused (422).`,
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { ...str, maxLength: 200 } }],
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${input}` } } } },
    responses: {
      '201': {
        description: 'Created',
        content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${output}` } } } } } },
      },
      ...errors,
      '413': { description: 'Body over 1 MB' },
      '422': { description: 'Refused by farm rules (duplicate, insufficient stock, unknown cage…)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  }
}

export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of API_ROUTES) {
    paths[r.path] = {
      get: {
        summary: r.summary,
        description: `Scope \`${r.scope}\`. Keys limited to sites only see those sites' rows, so a page can hold fewer than \`limit\` items; follow \`nextCursor\` while \`hasMore\` is true.`,
        parameters: listParams(r.dated),
        responses: {
          '200': {
            description: 'A page',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: `#/components/schemas/${r.schema}` } },
                    nextCursor: nullable(str),
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
          ...errors,
        },
      },
    }
    paths[`${r.path}/{id}`] = {
      get: {
        summary: `One ${r.schema}`,
        description: `Scope \`${r.scope}\`.`,
        parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
        responses: {
          '200': { description: 'Found', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: `#/components/schemas/${r.schema}` } } } } } },
          '404': { description: 'Not found (or not visible to this key)' },
          ...errors,
        },
      },
    }
  }
  paths['/api/v1/daily-records'].post = writeOp('Save daily records for one date', 'daily:write', 'DailyRecordsInput', 'DailyRecord')
  paths['/api/v1/sampling'].post = writeOp('Save sampling for one date', 'sampling:write', 'SamplingInput', 'Sampling')
  paths['/ingest/v1/readings'] = {
    post: {
      summary: 'Send sensor readings',
      description:
        'Scope `ingest:write`. Up to 500 water-quality readings per request. Each reading is checked on its own: bad ones are listed in `rejected` with a reason, readings already stored (same device, parameter and measuredAt) count as `duplicates`, so a gateway can safely resend a batch. 422 when nothing could be stored. ' +
        `Parameters: ${Object.entries(SENSOR_PARAMETERS).map(([k, p]) => `${k} (${p.unit || 'no unit'}, ${p.min}–${p.max})`).join(', ')}.`,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['readings'],
              properties: {
                readings: {
                  type: 'array', minItems: 1, maxItems: 500,
                  items: {
                    type: 'object',
                    required: ['deviceId', 'parameter', 'value', 'measuredAt'],
                    properties: {
                      deviceId: { ...str, maxLength: 100 },
                      parameter: { enum: Object.keys(SENSOR_PARAMETERS) },
                      value: num,
                      measuredAt: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'integer', description: 'epoch milliseconds' }] },
                      cageId: str,
                      siteId: { ...str, description: 'Used when no cageId is given' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Stored (some may be rejected)',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accepted: int, duplicates: int,
                  rejected: { type: 'array', items: { type: 'object', properties: { index: int, reason: str } } },
                },
              },
            },
          },
        },
        ...errors,
        '422': { description: 'No reading could be stored' },
      },
    },
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'PBA Farm API',
      version: '1.0.0',
      description:
        'Read your organization\'s farm data and record daily entries and sampling. ' +
        'Authenticate with `Authorization: Bearer pbk_…` (create keys under Settings → API keys). ' +
        'Rate limits: 120 requests per minute per key, 600 per organization; 429 responses carry Retry-After. ' +
        'Errors are `{ "error": { "code", "message" } }`. Version 1 only changes additively.',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: `API key. Scopes: ${Object.keys(API_SCOPES).join(', ')}.`,
        },
      },
      schemas,
    },
    paths,
  }
}
