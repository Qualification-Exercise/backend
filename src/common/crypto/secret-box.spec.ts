import { privateKeyToAddress } from 'viem/accounts';

import {
  decryptSecret,
  encryptSecret,
  generatePassword,
  isEncryptedSecret,
  SecretBoxError,
} from '@/common/crypto/secret-box';
import { createIssuerSigner, IssuerKeyError } from '@/issuer/signer';

const KEY =
  '0x603460d55025d41a674934c61fc54de1308051048db5632545a023ab8fceb765';
const ADDRESS = '0xf4B48550B9D15d419f77727107fd3cAF0c160DEc';

// Argon2id at the production floor (64 MiB, t=3) costs ~1.5 s per derivation in
// pure JS. That is the point of the parameters, so the tests share one blob and
// take the clock rather than weakening the KDF to run faster.
jest.setTimeout(60_000);

describe('secret box', () => {
  const password = generatePassword();
  let blob: string;

  beforeAll(() => {
    blob = encryptSecret(KEY, password);
  });

  it('round-trips a signing key', () => {
    expect(isEncryptedSecret(blob)).toBe(true);
    expect(blob).toMatch(/^argon2id\$m=65536,t=3,p=1\$/);
    expect(blob).not.toContain(KEY.slice(2));
    expect(decryptSecret(blob, password)).toBe(KEY);
  });

  it('gives a different ciphertext every time — the salt and IV are fresh', () => {
    expect(encryptSecret(KEY, password)).not.toBe(blob);
  });

  it('refuses the wrong password', () => {
    expect(() => decryptSecret(blob, generatePassword())).toThrow(
      SecretBoxError,
    );
  });

  it('refuses a tampered ciphertext — GCM authenticates it', () => {
    const [scheme, params, salt, payload] = blob.split('$');
    const bytes = Buffer.from(payload, 'base64');
    bytes[20] ^= 0xff;
    const tampered = [scheme, params, salt, bytes.toString('base64')].join('$');

    expect(() => decryptSecret(tampered, password)).toThrow(SecretBoxError);
  });

  it('refuses KDF parameters below the floor rather than trusting the blob', () => {
    const weakened = blob.replace('m=65536,t=3,p=1', 'm=8,t=1,p=1');

    expect(() => decryptSecret(weakened, password)).toThrow(/below the floor/);
  });

  it('demands a real password, not a passphrase someone chose', () => {
    expect(() => encryptSecret(KEY, 'hunter2')).toThrow(SecretBoxError);
    expect(generatePassword()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('createIssuerSigner with an encrypted key', () => {
  const password = generatePassword();
  let blob: string;

  beforeAll(() => {
    blob = encryptSecret(KEY, password);
  });

  it('opens the key and signs as the expected address', () => {
    const signer = createIssuerSigner(`enc:${blob}`, { password });

    expect(signer.address).toBe(ADDRESS);
    expect(privateKeyToAddress(KEY)).toBe(ADDRESS);
  });

  it('refuses without the password', () => {
    expect(() => createIssuerSigner(`enc:${blob}`, {})).toThrow(IssuerKeyError);
  });

  it('refuses a plaintext key unless development explicitly allows it', () => {
    expect(() => createIssuerSigner(`env:${KEY}`)).toThrow(IssuerKeyError);
    expect(
      createIssuerSigner(`env:${KEY}`, { allowPlaintextKey: true }).address,
    ).toBe(ADDRESS);
  });
});
