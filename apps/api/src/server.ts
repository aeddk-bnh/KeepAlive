import Fastify from 'fastify';
import cors from '@fastify/cors';
import { targetsRoutes } from './routes/targets';
import { sessionWatcher } from './services/sessionWatcher';

const fastify = Fastify({
  logger: true
});

const start = async () => {
  try {
    await fastify.register(cors, { origin: '*' });

    // Register routes
    await fastify.register(targetsRoutes);

    fastify.get('/api/status', async () => {
      return { status: 'OK', version: '1.0.0' };
    });

    // Start Session Watcher
    await sessionWatcher.start();

    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log(`🚀 Server is running at http://localhost:3001`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
