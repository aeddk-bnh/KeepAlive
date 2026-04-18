import { FastifyPluginAsync } from 'fastify';
import { browserService } from '@keepalive/browser-core';

export const sessionSyncRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = require('@keepalive/database');

  fastify.post('/api/session-sync/:id/open', async (request: any, reply: any) => {
    const { id } = request.params;
    const target = await db.target.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Target not found' });

    await browserService.getOrCreateSession(id, target.cookies, target.url);
    const result = await browserService.openSessionWindow(id);
    if (!result.success) return reply.code(400).send({ error: result.error || 'Failed to open session' });

    return {
      success: true,
      message: 'Session focused'
    };
  });

  fastify.get('/api/session-sync/:id/export', async (request: any, reply: any) => {
    const { id } = request.params;
    const target = await db.target.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Target not found' });

    const result = await browserService.exportSessionSnapshot(id, target.url, target.cookies);
    if (!result.snapshot) return reply.code(500).send({ error: result.error || 'Export failed' });
    return result.snapshot;
  });

  fastify.post('/api/session-sync/import', async (request: any, reply: any) => {
    const { url, cookies, refreshInterval, isActive } = request.body;
    if (!url || !cookies) return reply.code(400).send({ error: 'url and cookies are required' });

    try { JSON.parse(cookies); } catch { return reply.code(400).send({ error: 'cookies must be valid JSON' }); }

    const target = await db.target.create({
      data: {
        url,
        cookies,
        refreshInterval: refreshInterval || 60,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        status: 'IDLE'
      }
    });

    return { success: true, target };
  });

  fastify.post('/api/session-sync/:id/screenshot', async (request: any, reply: any) => {
    const { id } = request.params;
    const target = await db.target.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Target not found' });

    const result = await browserService.takeScreenshot(target.id, target.url, target.cookies);
    if (result.error) return reply.code(500).send({ error: result.error });
    return { image: result.image };
  });
};
