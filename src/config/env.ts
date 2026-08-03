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

  PAYMENT_POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  PAYMENT_POLL_PAGE_SIZE: z.coerce.number().int().positive().default(50),
  PAYMENT_POLL_MAX_MERCHANTS: z.coerce.number().int().positive().default(20),

  UTL_USD_RATE: z.string().default('1'),
  CASHBACK_BPS: z.coerce.number().int().nonnegative().default(500),

  ACCRUAL_POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  ACCRUAL_BATCH_SIZE: z.coerce.number().int().positive().default(50),

  PRICING_POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  PRICING_BATCH_SIZE: z.coerce.number().int().positive().default(25),

  CONFIRMATION_DEPTHS: z
    .string()
    .default(
      '{"1":12,"11155111":12,"421614":5,"80002":20,"4294967297":20,"4294967298":3,"4294967299":3}',
    )
    .refine(isJsonObject, 'CONFIRMATION_DEPTHS must be a JSON object'),
  RPC_URLS: z
    .string()
    .default('{}')
    .refine(isJsonObject, 'RPC_URLS must be a JSON object'),

  /**
   * Chains where two processes may share an endpoint, as a JSON array of
   * `srcChainId`s. Empty by default: a shared node collapses two independent
   * verifiers into one. Tron and Bitcoin have effectively one free public API
   * each, so a demo lists them here rather than pretending the guarantee holds.
   * With a paid key per process, take them back out.
   */
  RPC_SHARING_ALLOWED_CHAINS: z
    .string()
    .default('[]')
    .refine((v) => {
      try {
        return Array.isArray(JSON.parse(v));
      } catch {
        return false;
      }
    }, 'RPC_SHARING_ALLOWED_CHAINS must be a JSON array of chain ids'),

  REWARD_CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  ATTESTATION_THRESHOLD: z.coerce.number().int().positive().default(1),
  CLAIM_COOLDOWN_HOURS: z.coerce.number().nonnegative().default(24),
  CLAIM_DEADLINE_SECONDS: z.coerce.number().int().positive().default(3600),
  CLAIM_SWEEP_INTERVAL_MS: z.coerce.number().int().default(60_000),

  ISSUER_ID: z.string().default(''),
  SIGNER_KEY_PASSWORD: z.string().default(''),
  ISSUER_RPC_URL: z.string().default(''),

  ISSUER_RPC_URLS: z
    .string()
    .default('{}')
    .refine(isJsonObject, 'ISSUER_RPC_URLS must be a JSON object'),
  ISSUER_SIGNING_KEY: z.string().default(''),
  ISSUER_PRICE_PROVIDER: z.enum(['bitfinex', 'coingecko']).default('bitfinex'),
  ISSUER_POLL_INTERVAL_MS: z.coerce.number().int().default(15_000),
  ISSUER_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  PRICE_TOLERANCE_BPS: z.coerce.number().int().nonnegative().default(100),
  PRICE_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 3600),
  COUPON_CLAIM_CONTRACT_ADDRESS: z.string().default(''),
  TOKEN_ADDRESSES: z
    .string()
    .default('{}')
    .refine(isJsonObject, 'TOKEN_ADDRESSES must be a JSON object'),

  RELAYER_ID: z.string().default('relayer'),
  RELAYER_RPC_URL: z.string().default(''),
  RELAYER_RPC_URLS: z
    .string()
    .default('{}')
    .refine(isJsonObject, 'RELAYER_RPC_URLS must be a JSON object'),
  RELAYER_SIGNING_KEY: z.string().default(''),
  RELAYER_POLL_INTERVAL_MS: z.coerce.number().int().default(15_000),
  RELAYER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  RELAYER_CONFIRMATIONS: z.coerce.number().int().positive().default(2),
  RELAYER_DEADLINE_MARGIN_SECONDS: z.coerce.number().int().default(120),
  RELAYER_MAX_FEE_GWEI: z.coerce.number().positive().default(100),

  ALERT_WEBHOOK_URL: z.string().default(''),
  /**
   * Only read when ALERT_WEBHOOK_URL is a Telegram sendMessage URL: the Bot API
   * wants {chat_id, text}, not our alert shape, so the payload is rewritten.
   */
  ALERT_TELEGRAM_CHAT_ID: z.string().default(''),

  SETTLEMENT_RPC_URL: z.string().default(''),
  SETTLEMENT_POLL_INTERVAL_MS: z.coerce.number().int().default(20_000),
  SETTLEMENT_CONFIRMATIONS: z.coerce.number().int().positive().default(5),
  SETTLEMENT_BLOCK_RANGE: z.coerce.number().int().positive().default(2_000),
  SETTLEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .default(15 * 60_000),
  SETTLEMENT_START_BLOCK: z.coerce.number().int().nonnegative().default(0),

  MONITOR_RPC_URL: z.string().default(''),
  MONITOR_RPC_URLS: z
    .string()
    .default('{}')
    .refine(isJsonObject, 'MONITOR_RPC_URLS must be a JSON object'),
  MONITOR_SIGNING_KEY: z.string().default(''),
  MONITOR_POLL_INTERVAL_MS: z.coerce.number().int().default(60_000),
  MONITOR_SUPPLY_TOLERANCE_BPS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(50),
  MONITOR_SAMPLE_SIZE: z.coerce.number().int().positive().default(10),
  MONITOR_EPOCH_UTILISATION_PCT: z.coerce.number().int().positive().default(80),
  MONITOR_MAX_INDEXER_LAG_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(600),
  MONITOR_MAX_INDEXER_ERROR_PCT: z.coerce.number().int().positive().default(20),

  MONITOR_AUTO_PAUSE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
