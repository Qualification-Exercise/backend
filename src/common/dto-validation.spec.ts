import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EChainKind } from '@/chains/chain-kind.enum';
import { ListClaimsDTO } from '@/claims/dtos/list-claims.dto';
import { CreateClaimDTO } from '@/claims/dtos/create-claim.dto';
import { ListCouponsDTO } from '@/coupons/dtos/list-coupons.dto';
import { PutSecretDTO } from '@/secrets/dtos/put-secret.dto';
import { CreateTransactionDTO } from '@/transactions/dtos/create-transaction.dto';
import { ListTransactionsDTO } from '@/transactions/dtos/list-transactions.dto';
import { ETxStatus, ETxType } from '@/transactions/enums/tx.enum';
import { LinkWalletsDTO } from '@/wallets/dtos/link-wallets.dto';

const UUID = '2f0c9d9e-6e2a-4a1e-9c66-7a1f0b4d2e11';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SIGNATURE = `0x${'ab'.repeat(65)}`;

function errorsFor<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): string[] {
  const instance = plainToInstance(cls, payload, {
    enableImplicitConversion: false,
  });
  return validateSync(instance as object, { whitelist: false }).flatMap(
    function collect(error): string[] {
      return [
        ...(error.constraints ? [error.property] : []),
        ...(error.children ?? []).flatMap(collect),
      ];
    },
  );
}

describe('CreateClaimDTO', () => {
  it('accepts a challenge answer', () => {
    expect(
      errorsFor(CreateClaimDTO, {
        challengeId: UUID,
        signature: SIGNATURE,
        code: 'CB-8F3A21',
      }),
    ).toEqual([]);
  });

  it.each([
    ['a signature of the wrong length', { signature: `0x${'ab'.repeat(64)}` }],
    ['a signature that is not hex', { signature: `0x${'zz'.repeat(65)}` }],
    ['a challenge id that is not a uuid', { challengeId: 'chl-1' }],
    ['a coupon id that is not a uuid', { couponId: 'cpn-1' }],
    ['a code longer than the column', { code: 'C'.repeat(65) }],
  ])('rejects %s', (_label, override) => {
    expect(
      errorsFor(CreateClaimDTO, {
        challengeId: UUID,
        signature: SIGNATURE,
        ...override,
      }),
    ).not.toEqual([]);
  });
});

describe('CreateTransactionDTO', () => {
  const valid = {
    chain: EChainKind.EVM,
    srcChainId: 1,
    txHash: `0x${'ab'.repeat(32)}`,
    direction: 'out',
    token: 'USDT',
    amount: '1000000',
    from: ADDRESS,
    to: ADDRESS,
  };

  it('accepts a broadcast transaction, with or without a fee', () => {
    expect(errorsFor(CreateTransactionDTO, valid)).toEqual([]);
    expect(
      errorsFor(CreateTransactionDTO, {
        ...valid,
        fee: { token: 'ETH', amount: '210000000000000' },
        type: ETxType.TRANSFER,
        outputIndex: 0,
        broadcastAt: '2026-08-05T10:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it.each([
    ['a fractional amount', { amount: '1.5' }],
    ['a negative amount', { amount: '-1' }],
    ['an amount that is a number, not a string', { amount: 1000000 }],
    ['an amount wider than 78 digits', { amount: '1'.repeat(79) }],
    ['an unknown chain family', { chain: 'SOLANA' }],
    ['a direction that is neither in nor out', { direction: 'sideways' }],
    ['a negative output index', { outputIndex: -1 }],
    ['a broadcast time that is not ISO-8601', { broadcastAt: 'yesterday' }],
    [
      'a fee amount that is not an integer string',
      { fee: { token: 'ETH', amount: '0.1' } },
    ],
  ])('rejects %s', (_label, override) => {
    expect(
      errorsFor(CreateTransactionDTO, { ...valid, ...override }),
    ).not.toEqual([]);
  });
});

describe('ListTransactionsDTO', () => {
  it('accepts the filters it documents', () => {
    expect(
      errorsFor(ListTransactionsDTO, {
        chain: EChainKind.EVM,
        srcChainId: 1,
        type: ETxType.TRANSFER,
        status: ETxStatus.PENDING,
        limit: 10,
        cursor: 'abc',
      }),
    ).toEqual([]);
  });

  it.each([
    ['a status outside the enum', { status: 'MAYBE' }],
    ['a zero page size', { limit: 0 }],
  ])('rejects %s', (_label, override) => {
    expect(errorsFor(ListTransactionsDTO, override)).not.toEqual([]);
  });
});

describe('LinkWalletsDTO', () => {
  const entry = {
    chain: EChainKind.EVM,
    srcChainId: 1,
    address: ADDRESS,
    path: "m/44'/60'/0'/0/0",
  };

  it('accepts one to eight entries', () => {
    expect(errorsFor(LinkWalletsDTO, { wallets: [entry] })).toEqual([]);
  });

  it.each([
    ['an empty list', []],
    ['more than eight entries', Array.from({ length: 9 }, () => entry)],
  ])('rejects %s', (_label, wallets) => {
    expect(errorsFor(LinkWalletsDTO, { wallets })).not.toEqual([]);
  });

  it('validates each nested entry', () => {
    expect(
      errorsFor(LinkWalletsDTO, {
        wallets: [{ ...entry, chain: 'SOLANA' }],
      }),
    ).not.toEqual([]);
    expect(
      errorsFor(LinkWalletsDTO, {
        wallets: [{ ...entry, srcChainId: -1 }],
      }),
    ).not.toEqual([]);
    expect(
      errorsFor(LinkWalletsDTO, {
        wallets: [{ ...entry, address: 'x'.repeat(129) }],
      }),
    ).not.toEqual([]);
  });
});

describe('PutSecretDTO', () => {
  const valid = {
    entropy: 'ZW50cm9weQ==',
    wrappedKey: {
      ciphertext: 'd3JhcHBlZA==',
      kdf: { algo: 'argon2id', salt: 'c2FsdA==', m: 65536, t: 3, p: 1 },
    },
    metadata: { address: ADDRESS, wordCount: 12 },
  };

  it('accepts a client-encrypted blob', () => {
    expect(errorsFor(PutSecretDTO, valid)).toEqual([]);
  });

  it.each([
    ['ciphertext that is not base64', { entropy: 'not base64!!' }],
    [
      'a word count outside 12 or 24',
      { metadata: { address: ADDRESS, wordCount: 15 } },
    ],
    [
      'a KDF algorithm we do not implement',
      {
        wrappedKey: {
          ...valid.wrappedKey,
          kdf: { ...valid.wrappedKey.kdf, algo: 'scrypt' },
        },
      },
    ],
    [
      'a non-positive KDF cost',
      {
        wrappedKey: {
          ...valid.wrappedKey,
          kdf: { ...valid.wrappedKey.kdf, t: 0 },
        },
      },
    ],
    [
      'a cipher we do not implement',
      { wrappedKey: { ...valid.wrappedKey, cipher: 'aes-128-cbc' } },
    ],
  ])('rejects %s', (_label, override) => {
    expect(errorsFor(PutSecretDTO, { ...valid, ...override })).not.toEqual([]);
  });
});

describe('list DTOs', () => {
  it('accept an empty query and reject a bad page size', () => {
    expect(errorsFor(ListCouponsDTO, {})).toEqual([]);
    expect(errorsFor(ListClaimsDTO, {})).toEqual([]);
    expect(errorsFor(ListClaimsDTO, { limit: 0 })).not.toEqual([]);
  });
});
