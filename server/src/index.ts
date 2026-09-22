/** Server entrypoint: connect DB, build app, listen, handle graceful shutdown. */
import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await connectDatabase();

  const app = buildApp();
  const server = createServer(app);

  // Socket.IO is attached here in Phase 3 (realtime). Contract in docs/architecture.

  server.listen(config.PORT, () => {
    logger.info(`🚀 CampusConnect API listening on :${config.PORT} (${config.NODE_ENV})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down…');
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
