import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  APP_NAME: z.string().default('wdk-backend'),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USERNAME: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
  // NOT z.coerce.boolean(): Boolean('false') is true, which silently turns
  // synchronize on in every environment that sets it to 'false'.
  DB_SYNCHRONIZE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRATION: z.coerce.number().default(3600),
  AUTH_PROVIDER: z.enum(['auth0', 'keycloak', 'cognito']).default('auth0'),
  AUTH_ISSUER: z.string().url(),
  AUTH_AUDIENCE: z.string(),
  JWKS_URI: z.string().url(),

  SEED_BACKUP_ENCRYPTION_KEY: z.string().min(32),

  INDEXER_BASE_URL: z.string().url(),
  INDEXER_API_KEY: z.string(),

  UTILITY_TOKEN_CONTRACT_ADDRESS: z.string(),
  UTILITY_TOKEN_CONTRACT_ABI: z.string().default('[]'),

  SUPPORTED_CHAINS: z
    .string()
    .default('BTC,SPARK,ARBITRUM,ETHEREUM,POLYGON,TRON'),
  SUPPORTED_ASSETS: z.string().default('BTC,USDT'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Environment validation failed: ${errors}`);
  }

  return parsed.data;
}
