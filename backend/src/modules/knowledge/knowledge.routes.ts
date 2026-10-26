import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';
import { knowledgeList, createKnowledgeBase, uploadKnowledge, changeKnowledge, askKnowledge, knowledgeDownload, setKnowledgeAccess, retryKnowledge } from './knowledge.service.js';
import { startKnowledgeWorker } from './knowledge.worker.js';

const idOf = (req: { params: unknown }) => z.object({ id: z.string().uuid() }).parse(req.params).id;
export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/api/knowledge/bases', knowledgeList);
  app.post('/api/knowledge/bases', async req => createKnowledgeBase(req, z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(req.body).name));
  app.post('/api/knowledge/bases/:id/reindex', async req => retryKnowledge(req, idOf(req), 'base'));
  app.post('/api/knowledge/documents/:id/reindex', async req => retryKnowledge(req, idOf(req), 'document'));
  app.put('/api/knowledge/bases/:id/access', async req => setKnowledgeAccess(req, idOf(req), z.object({ readAccess: z.enum(['account', 'owner']) }).strict().parse(req.body).readAccess));
  app.post('/api/knowledge/bases/:id/documents', async req => {
    const id = idOf(req);
    const file = await req.file({ limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 } });
    if (!file) throw new AppError(422, '请选择文件');
    const bytes = await file.toBuffer();
    if (file.file.truncated) throw new AppError(422, '文件超过 20 MB');
    return uploadKnowledge(req, id, file.filename, bytes);
  });
  app.post('/api/knowledge/documents/:id/publish', async req => {
    const body = z.object({ customerApproved: z.boolean().default(false) }).strict().parse(req.body ?? {});
    return changeKnowledge(req, idOf(req), 'publish', body.customerApproved);
  });
  app.post('/api/knowledge/documents/:id/withdraw', async req => changeKnowledge(req, idOf(req), 'withdraw'));
  app.delete('/api/knowledge/documents/:id', async req => changeKnowledge(req, idOf(req), 'delete'));
  app.get('/api/knowledge/documents/:id/download', async (req, reply) => {
    const { bytes, filename } = await knowledgeDownload(req, idOf(req));
    return reply.header('Content-Type', 'application/octet-stream').header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`).send(bytes);
  });
  app.post('/api/knowledge/ask', async req => {
    const body = z.object({ question: z.string().trim().min(1).max(1000), conversationId: z.number().int().positive().optional() }).strict().parse(req.body);
    return askKnowledge(req, body.question, body.conversationId);
  });
  startKnowledgeWorker(app);
}
