/** MongoDB connection via Mongoose, with retry/backoff. Sole primary datastore (ADR-0001). */
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase(maxRetries = 5): Promise<typeof mongoose> {
  let attempt = 0;
  while (true) {
    try {
      const conn = await mongoose.connect(config.MONGODB_URI, {
        dbName: config.MONGODB_DB_NAME,
        serverSelectionTimeoutMS: 5000,
      });
      logger.info('✅ MongoDB connected');
      return conn;
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries) {
        logger.error({ err }, '❌ MongoDB connection failed after retries');
        throw err;
      }
      const delay = Math.min(1000 * 2 ** attempt, 15_000);
      logger.warn({ attempt, delay }, 'MongoDB connect retry');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
