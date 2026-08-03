/**
 * Local-only helper for exercising the API by hand.
 *
 * Postman cannot produce a secp256k1 signature, so this prints the two things a
 * manual run needs: a JWT the guard accepts, and the claim-screen signature over
 * a challenge nonce.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/dev-token.ts
 *   npx ts-node -r tsconfig-paths/register scripts/dev-token.ts sign <nonce> <coupon>
 *
 * Never run this against anything but a local database.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

import { validateEnv } from '@/config/env';
import { AppDataSource } from '@/database/data-source';
import { User } from '@/users/entities/user.entity';
import { claimMessage } from '@/wallets/address';

const env = validateEnv(process.env);

/** Well-known Hardhat account #0 — a test key, never anything real. */
const DEV_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const DEV_SUB = 'dev|local-1';
const DEV_EMAIL = 'dev@example.com';

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url');

function signJwt(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac('sha256', env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function issueToken(sub = DEV_SUB) {
  const email = sub === DEV_SUB ? DEV_EMAIL : `${sub}@example.com`;

  await AppDataSource.initialize();
  const users = AppDataSource.getRepository(User);

  let user = await users.findOne({ where: { externalAuthId: sub } });
  if (!user) {
    user = await users.save(users.create({ externalAuthId: sub, email }));
  }
  await AppDataSource.destroy();

  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    sub,
    email,
    iss: env.AUTH_ISSUER,
    aud: env.AUTH_AUDIENCE,
    iat: now,
    exp: now + env.JWT_EXPIRATION,
  });

  console.log(`userId:  ${user.id}`);
  console.log(`address: ${privateKeyToAccount(DEV_PRIVATE_KEY).address}`);
  console.log(`token:   ${token}`);
}

async function sign(nonce: string, coupon: string) {
  if (!nonce || !coupon) {
    throw new Error('usage: dev-token.ts sign <nonce> <coupon-code>');
  }
  const account = privateKeyToAccount(DEV_PRIVATE_KEY);
  // The same string `GET /claims/challenge` returns in `message`.
  const message = claimMessage(nonce, coupon);
  console.log(`address:   ${account.address}`);
  console.log(`message:   ${JSON.stringify(message)}`);
  console.log(`signature: ${await account.signMessage({ message })}`);
}

const [command, arg, arg2] = process.argv.slice(2);
const run =
  command === 'sign' ? sign(arg, arg2) : issueToken(command || undefined);

run.catch((err) => {
  console.error(err);
  process.exit(1);
});
