import type { FastifyInstance } from 'fastify';
import { HttpError } from '../settle/validation.js';
import type { RegistrationService } from './service.js';

export function registerRegistrationRoutes(app: FastifyInstance, service: RegistrationService): void {
  app.register(async scope => {
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      const detail = error as { code?: string; statusCode?: number };
      if (detail.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'bad_json', message: 'Body exceeds 4 KB.' });
      if (detail.statusCode === 400) return reply.code(400).send({ error: 'bad_json', message: 'Invalid JSON body.' });
      return reply.code(500).send({ error: 'internal_error', message: 'Unable to read registration state.' });
    });
    scope.post('/v1/payers', { bodyLimit: 4096 }, async (request, reply) => {
      const result = await service.submit('payer', request.body); return reply.code(result.statusCode).send(result.body);
    });
    scope.post('/v1/merchants', { bodyLimit: 4096 }, async (request, reply) => {
      const result = await service.submit('merchant', request.body); return reply.code(result.statusCode).send(result.body);
    });
  });
}
