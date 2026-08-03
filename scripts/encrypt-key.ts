import { createInterface } from 'node:readline/promises';

import { encryptSecret, generatePassword } from '@/common/crypto/secret-box';

/**
 * Wraps a signing key for an env file:
 *
 *   npm run key:password                 # generate SIGNER_KEY_PASSWORD
 *   SIGNER_KEY_PASSWORD=0x… npm run key:encrypt
 *
 * The key is read from stdin, never from argv — an argument is visible in
 * `ps`, in the shell history, and in whatever collects both.
 */
async function main() {
  if (process.argv.includes('--password')) {
    process.stdout.write(`${generatePassword()}\n`);
    return;
  }

  const password = process.env.SIGNER_KEY_PASSWORD;
  if (!password) {
    throw new Error('Set SIGNER_KEY_PASSWORD first: npm run key:password');
  }

  const rl = createInterface({ input: process.stdin });
  const key = (await rl.question('')).trim();
  rl.close();

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('Expected a 32-byte hex private key on stdin');
  }

  process.stdout.write(`enc:${encryptSecret(key, password)}\n`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
