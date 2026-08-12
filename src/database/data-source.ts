import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateEnv } from '@/config/env';
import { ENTITIES } from './entities';
import { migrations } from './migrations';

const env = validateEnv(process.env);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  synchronize: env.DB_SYNCHRONIZE,
  logging: env.DB_LOGGING,
  entities: ENTITIES,
  migrations,
  subscribers: [],
  migrationsTransactionMode: 'all',
});
