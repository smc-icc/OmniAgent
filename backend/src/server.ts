import { buildApp } from './app.js';
import { env } from './config/env.js';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Server running at http://${env.HOST}:${env.PORT}`);
    app.log.info(`Health check: http://${env.HOST}:${env.PORT}/health`);
    app.log.info(`API index:    http://${env.HOST}:${env.PORT}/api`);
    app.log.info(`Database:     ${new URL(env.DATABASE_URL).host}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
