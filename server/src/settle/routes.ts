import type { FastifyInstance } from 'fastify';
import type { SettlementService } from './service.js';
import { HttpError } from './validation.js';

export function registerSettlementRoutes(app: FastifyInstance, service: SettlementService): void {
  // Encapsulate the error handler so Jordan's other endpoints retain their own policy.
  app.register(async scope => {
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      const detail = error as { code?: string; statusCode?: number };
      if (detail?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'bad_json', message: 'Body exceeds 4 KB' });
      if (detail?.statusCode === 400) return reply.code(400).send({ error: 'bad_json', message: 'Invalid JSON body' });
      // Do not return chain_unavailable here: an unknown database result may already hold a claim.
      return reply.code(500).send({ error: 'internal_error', message: 'Unable to read settlement state' });
    });
    scope.post('/v1/notes', { bodyLimit: 4096 }, async (request, reply) => {
      const result = await service.submit(request.body);
      return reply.code(result.statusCode).send(result.body);
    });
    scope.get<{ Params: { noteId: string } }>('/v1/notes/:noteId', async (request, reply) => {
      const result = await service.get(request.params.noteId);
      return reply.code(result.statusCode).send(result.body);
    });
  });
}
