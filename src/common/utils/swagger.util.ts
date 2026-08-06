import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

const DESCRIPTION = `
Cashback/coupon system with multi-chain asset support and WDK indexer integration.

## Flow
1. \`POST /auth/google\` — exchange a Google ID token for access/refresh tokens.
2. \`POST /wallets\` — link the chain addresses derived on the client.
3. \`PUT /secrets/{entropy|seed}\` — store the client-encrypted backup blob (server never sees plaintext).
4. \`POST /transactions\` — record an on-chain payment; once confirmed it issues a coupon.
5. \`GET /coupons\` → \`GET /claims/challenge\` → \`POST /claims\` — claim cashback as UTL.

## Conventions
- All routes except \`GET /health\` are served under the \`/api\` prefix.
- Auth: \`Authorization: Bearer <accessToken>\`. Authorize once via the lock button.
- Amounts are integer strings in the asset's smallest unit — never floats.
- Writes that create money-moving records (\`POST /transactions\`, \`POST /claims\`) accept an
  \`Idempotency-Key\` header; a repeat with the same key returns the first result.
- List endpoints are cursor-paginated: pass the returned \`cursor\` back as \`?cursor=\`.
- Errors: \`{ statusCode, message, error }\`; \`message\` carries a code from \`EErrorCodes\`.
- Rate limits apply per route (secret reads and transaction writes are the tightest).
`.trim();

export function setupSwagger(app: INestApplication, port: number): void {
  const builder = new DocumentBuilder()
    .setTitle('WDK Backend API')
    .setDescription(DESCRIPTION)
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Access token from POST /auth/google or /auth/refresh',
        in: 'header',
      },
      'jwt', // Must match @ApiBearerAuth('jwt') on controllers.
    )
    .addTag('auth', 'Google OIDC login, token refresh, dev tokens')
    .addTag('users', 'Current user profile and onboarding status')
    .addTag('wallets', 'Link and list per-chain addresses')
    .addTag('secrets', 'Client-encrypted entropy/seed backup blobs')
    .addTag('transactions', 'Record and query on-chain payments')
    .addTag('balances', 'Aggregated per-asset balances')
    .addTag('merchants', 'Addresses whose incoming transfers earn cashback')
    .addTag('coupons', 'Cashback coupons issued for confirmed payments')
    .addTag('claims', 'Claim coupons as UTL on-chain')
    .addTag('pricing', 'Live asset prices')
    .addTag('indexer', 'Raw WDK indexer passthrough')
    .addTag('config', 'Public runtime configuration')
    .addTag('health', 'Liveness and dependency status');

  if (process.env.NODE_ENV === 'development') {
    builder.addServer(`http://localhost:${port}`, 'Local');
  }

  const config = builder.build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/json',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      displayRequestDuration: true,
      docExpansion: 'none',
    },
    customSiteTitle: 'WDK Backend API Docs',
  });
}
