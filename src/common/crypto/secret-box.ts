import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { argon2id } from '@noble/hashes/argon2.js';

export class SecretBoxError extends Error {}

export const KDF_FLOOR = { m: 65_536, t: 3, p: 1 } as const;

const SCHEME = 'argon2id';
const SALT_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

interface IParsed {
  m: number;
  t: number;
  p: number;
  salt: Buffer;
  payload: Buffer;
}

export function encryptSecret(plaintext: string, password: string): string {
  const passwordBytes = passwordToBytes(password);
  const salt = randomBytes(SALT_BYTES);
  const key = derive(passwordBytes, salt, KDF_FLOOR);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);

  key.fill(0);
  passwordBytes.fill(0);

  const { m, t, p } = KDF_FLOOR;
  return `${SCHEME}$m=${m},t=${t},p=${p}$${salt.toString('base64')}$${payload.toString('base64')}`;
}

export function decryptSecret(blob: string, password: string): string {
  const { m, t, p, salt, payload } = parse(blob);

  if (m < KDF_FLOOR.m || t < KDF_FLOOR.t || p < KDF_FLOOR.p) {
    throw new SecretBoxError(
      `KDF parameters are below the floor (m=${m},t=${t},p=${p}); re-encrypt the secret`,
    );
  }
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new SecretBoxError('Ciphertext is too short to contain a payload');
  }

  const passwordBytes = passwordToBytes(password);
  const key = derive(passwordBytes, salt, { m, t, p });

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES, payload.length - TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretBoxError(
      'Could not decrypt: wrong password or corrupt blob',
    );
  } finally {
    key.fill(0);
    passwordBytes.fill(0);
  }
}

export function generatePassword(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${SCHEME}$`);
}

function passwordToBytes(password: string): Buffer {
  const trimmed = password.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new SecretBoxError(
      'Password must be 32 random bytes as 0x-prefixed hex (see key:password)',
    );
  }
  return Buffer.from(trimmed.slice(2), 'hex');
}

function derive(
  password: Buffer,
  salt: Buffer,
  params: { m: number; t: number; p: number },
): Buffer {
  return Buffer.from(
    argon2id(password, salt, {
      m: params.m,
      t: params.t,
      p: params.p,
      dkLen: KEY_BYTES,
    }),
  );
}

function parse(blob: string): IParsed {
  const [scheme, params, salt, payload] = blob.trim().split('$');
  if (scheme !== SCHEME || !params || !salt || !payload) {
    throw new SecretBoxError(
      'Expected argon2id$m=..,t=..,p=..$<salt>$<payload>',
    );
  }

  const parsed = Object.fromEntries(
    params.split(',').map((pair) => {
      const [name, value] = pair.split('=');
      return [name, Number(value)];
    }),
  ) as { m?: number; t?: number; p?: number };

  if (!parsed.m || !parsed.t || !parsed.p) {
    throw new SecretBoxError(`Unreadable KDF parameters: ${params}`);
  }

  const saltBytes = Buffer.from(salt, 'base64');
  if (saltBytes.length !== SALT_BYTES) {
    throw new SecretBoxError(`Salt must be ${SALT_BYTES} bytes`);
  }

  return {
    m: parsed.m,
    t: parsed.t,
    p: parsed.p,
    salt: saltBytes,
    payload: Buffer.from(payload, 'base64'),
  };
}

export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
