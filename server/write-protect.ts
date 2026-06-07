import type { FastifyReply, FastifyRequest } from 'fastify';
import { WRITE_TOKEN } from './config.js';

export function requireWriteAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!WRITE_TOKEN) return true;
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header);
  if (!match || match[1] !== WRITE_TOKEN) {
    reply.header('www-authenticate', 'Bearer');
    reply.code(401).send({ error: 'write token required' });
    return false;
  }
  return true;
}
