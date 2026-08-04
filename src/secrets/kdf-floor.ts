/**
 * The KDF floor the device must meet before the server will store a wrapped
 * key. Published by `GET /config` so the app derives with the same numbers the
 * server checks — the only passphrase-dependent object in the system is that
 * wrapped key, so this is the whole strength of a stolen-database scenario.
 *
 * The server cannot verify the passphrase was strong. It can verify the
 * derivation was, and it refuses anything weaker.
 */
export const SECRETS_KDF_FLOOR = {
  algo: 'argon2id',
  m: 65_536,
  t: 3,
  p: 1,
  minPassphraseLength: 12,
  minZxcvbnScore: 3,
} as const;

/** Base64 lengths, fixed by the format — anything larger is not a backup. */
export const SECRET_MAX_LENGTHS = {
  entropy: 128,
  seed: 192,
  wrappedKey: 256,
} as const;
