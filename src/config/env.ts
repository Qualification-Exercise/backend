import { z } from 'zod';

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return (
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

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

  GOOGLE_IOS_CLIENT_ID: z.string(),
  GOOGLE_ANDROID_CLIENT_ID: z.string(),
  GOOGLE_WEB_CLIENT_ID: z.string().optional(),
  REFRESH_TOKEN_EXPIRATION: z.coerce.number().default(60 * 60 * 24 * 7),

  SEED_BACKUP_ENCRYPTION_KEY: z.string().min(32),

  INDEXER_BASE_URL: z.string().url(),
  INDEXER_API_KEY: z.string(),

  /** 0 or less disables the payment poller — useful for tests and the API-only role. */
  PAYMENT_POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  /** How far past the cursor each poll reaches; the API has no offset parameter. */
  PAYMENT_POLL_PAGE_SIZE: z.coerce.number().int().positive().default(50),
  PAYMENT_POLL_MAX_MERCHANTS: z.coerce.number().int().positive().default(20),

  /**
   * Administrative UTL rate in USD. UTL has no market, so this is a decision, not
   * a price — configuration, never a literal in the accrual code. Exposed via
   * GET /config so a client can explain the number it shows.
   */
  UTL_USD_RATE: z.string().default('1'),
  /** Cashback rate in basis points; 500 = 5 %. */
  CASHBACK_BPS: z.coerce.number().int().nonnegative().default(500),

  /** 0 or less disables the accrual loop. */
  ACCRUAL_POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  ACCRUAL_BATCH_SIZE: z.coerce.number().int().positive().default(50),

  /** 0 or less disables the pricing loop. */
  PRICING_POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  PRICING_BATCH_SIZE: z.coerce.number().int().positive().default(25),

  /** Blocks of depth before a payment counts as money, keyed by srcChainId. */
  CONFIRMATION_DEPTHS: z
    .string()
    .default(
      '{"11155111":12,"421614":5,"80002":20,"4294967297":20,"4294967298":3,"4294967299":3}',
    )
    .refine(isJsonObject, 'CONFIRMATION_DEPTHS must be a JSON object'),
  /** Chain head source per srcChainId. A chain with no RPC never confirms. */
  RPC_URLS: z
    .string()
    .default('{}')
    .refine(isJsonObject, 'RPC_URLS must be a JSON object'),

  UTILITY_TOKEN_CONTRACT_ADDRESS: z.string(),
  UTILITY_TOKEN_CONTRACT_ABI: z.string().default('[]'),

  SUPPORTED_CHAINS: z
    .string()
    .default('BTC,SPARK,ARBITRUM,ETHEREUM,POLYGON,TRON'),
  SUPPORTED_ASSETS: z.string().default('BTC,USDT'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  CORS_ORIGINS: z.string().default('*'),
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
