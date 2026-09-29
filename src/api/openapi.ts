import { z } from 'zod';
import type { RouteDef } from './framework';

function schemaOf(t: unknown) {
  try { const j: any = z.toJSONSchema(t as z.ZodType, { unrepresentable: 'any', io: 'input' }); delete j.$schema; return j; } catch { return { type: 'object' }; }
}

export function buildOpenApi(routes: RouteDef[]) {
  const paths: Record<string, any> = {};
  for (const r of routes) {
    const p = r.path.replace(/:([a-zA-Z]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const q = r.query ? Object.entries((schemaOf(r.query).properties ?? {}) as Record<string, any>).map(([name, s]) => ({ name, in: 'query', required: false, schema: s })) : [];
    paths[p] ??= {};
    paths[p][r.method.toLowerCase()] = {
      tags: [r.tag], summary: r.summary, operationId: `${r.method.toLowerCase()}_${p.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      security: r.auth === 'public' || r.auth === 'webhook' ? [] : [{ cookieAuth: [] }],
      'x-permission': r.permission ? `${r.permission[0]}:${r.permission[1]}` : r.auth === 'public' ? 'public' : r.auth === 'webhook' ? 'signature' : 'any signed-in user',
      parameters: [...params, ...q],
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(r.body) } } } } : r.multipart ? { requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, caseId: { type: 'string' }, orgId: { type: 'string' } }, required: ['file'] } } } } } : {}),
      responses: {
        '200': { description: 'Success. Body is { data }' }, '400': { description: 'Validation failed. Body is { error: { code, message, details, requestId } }' },
        '401': { description: 'Not signed in' }, '403': { description: 'Not allowed' }, '404': { description: 'Not found or outside your scope' }, '429': { description: 'Too many requests' }
      }
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Samakose AI Business Health OS API', version: '1.0.0', description: 'Session cookie authentication. Every write is audited. Lists accept q, page, pageSize, sort, dir and format=csv where export is permitted.' },
    servers: [{ url: '/api/v1' }],
    tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({ name })),
    components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sk_session' } } },
    paths
  };
}
