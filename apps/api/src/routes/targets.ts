import { FastifyPluginAsync } from 'fastify';
import { browserService } from '@keepalive/browser-core';

export const targetsRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = require('@keepalive/database');

  fastify.get('/api/targets', async () => {
    return await db.target.findMany({
      include: {
        logs: { orderBy: { timestamp: 'desc' }, take: 5 }
      },
      orderBy: { id: 'asc' }
    });
  });

  fastify.post('/api/targets', async (request: any) => {
    const { url, cookies, refreshInterval } = request.body;
    return await db.target.create({
      data: { url, cookies, refreshInterval: refreshInterval || 60 }
    });
  });

  fastify.put('/api/targets/:id', async (request: any) => {
    const { id } = request.params;

    // If pausing or changing cookies, close the existing persistent session
    if (request.body.isActive === false || request.body.cookies) {
      await browserService.closeSession(id);
    }

    return await db.target.update({
      where: { id },
      data: request.body
    });
  });

  fastify.delete('/api/targets/:id', async (request: any) => {
    const { id } = request.params;
    await browserService.closeSession(id);
    return await db.target.delete({
      where: { id }
    });
  });

  fastify.post('/api/targets/:id/screenshot', async (request: any, reply: any) => {
    const { id } = request.params;

    const target = await db.target.findUnique({
      where: { id }
    });

    if (!target) {
      return reply.code(404).send({ error: 'Target not found' });
    }

    fastify.log.info(`Taking screenshot for target: ${target.url}`);

    const result = await browserService.takeScreenshot(target.id, target.url, target.cookies);

    if (result.error) {
      fastify.log.error(`Screenshot failed: ${result.error}`);
      return reply.code(500).send({ error: result.error });
    }

    return { image: result.image };
  });
};
