import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  ENTITLEMENT_TYPES,
  entitlementDigest,
  entitlementDomain,
  entitlementDomainSeparator,
} from '@/issuer/entitlement';
import {
  createIssuerSigner,
  IssuerKeyError,
  type WdkLoader,
} from '@/issuer/signer';

/**
 * The contracts repo's committed fixture, read directly — never a copy. If this
 * fails, TypeScript and Solidity disagree about what the issuers are signing,
 * and K signatures would land on K digests the contract never accepts. The fix
 * is never "edit the fixture".
 */
const FIXTURE_PATH =
  process.env.ENTITLEMENT_FIXTURE ??
  resolve(__dirname, '../../../contract/test/fixtures/entitlement.json');

interface IFixture {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Hex;
  };
  domainSeparator: Hex;
  message: {
    recipient: Hex;
    amount: string;
    paymentRef: Hex;
    deadline: string;
  };
  digest: Hex;
}

const EMPTY_FIXTURE: IFixture = {
  domain: {
    name: '',
    version: '',
    chainId: 0,
    verifyingContract: '0x',
  },
  domainSeparator: '0x',
  message: { recipient: '0x', amount: '0', paymentRef: '0x', deadline: '0' },
  digest: '0x',
};

let fixture: IFixture = EMPTY_FIXTURE;
let fixtureAvailable = true;
try {
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as IFixture;
} catch {
  fixtureAvailable = false;
  console.warn(
    `entitlement.json not found at ${FIXTURE_PATH}; contract cross-check skipped. ` +
      'Check out Qualification-Exercise/contracts beside this repo, or set ENTITLEMENT_FIXTURE.',
  );
}

const describeFixture = fixtureAvailable ? describe : describe.skip;

const domain = {
  chainId: fixture.domain.chainId,
  verifyingContract: fixture.domain.verifyingContract,
};
const message = {
  recipient: fixture.message.recipient,
  amount: BigInt(fixture.message.amount),
  paymentRef: fixture.message.paymentRef,
  deadline: BigInt(fixture.message.deadline),
};

/**
 * Jest's CommonJS runtime cannot import the ESM `@tetherto/wdk-wallet-evm`, so
 * these tests drive the same code path with a stand-in account. The real WDK
 * signer is exercised by `npm run verify:signer` under plain node.
 */
function fakeWdk(): WdkLoader {
  return async () => ({
    WalletAccountEvm: {
      fromPrivateKey(key: string) {
        const account = privateKeyToAccount(key as `0x${string}`);
        return {
          getAddress: async () => account.address,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          signTypedData: (data: any) =>
            account.signTypedData({ ...data, primaryType: 'Entitlement' }),
          signTransaction: async () => {
            throw new Error('an issuer key never signs a transaction');
          },
        };
      },
    },
  });
}

describeFixture('EIP-712 entitlement', () => {
  it('produces the domain separator the contract committed to', () => {
    expect(entitlementDomainSeparator(domain)).toBe(fixture.domainSeparator);
  });

  it('produces the digest the contract committed to', () => {
    expect(entitlementDigest(domain, message)).toBe(fixture.digest);
  });

  it('binds the signature to one contract on one chain', () => {
    const elsewhere = entitlementDigest({ ...domain, chainId: 1 }, message);
    const otherContract = entitlementDigest(
      {
        ...domain,
        verifyingContract: '0x2222222222222222222222222222222222222222',
      },
      message,
    );

    expect(elsewhere).not.toBe(fixture.digest);
    expect(otherContract).not.toBe(fixture.digest);
  });
});

describeFixture('issuer signer', () => {
  const key =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

  it('signs the fixture digest recoverably', async () => {
    const signer = createIssuerSigner(`env:${key}`, {
      allowPlaintextKey: true,
      loadWdk: fakeWdk(),
    });
    const signature = await signer.signEntitlement(domain, message);

    const recovered = await recoverTypedDataAddress({
      domain: entitlementDomain(domain),
      types: ENTITLEMENT_TYPES,
      primaryType: 'Entitlement',
      message,
      signature,
    });

    expect(recovered).toBe(privateKeyToAccount(key).address);
    expect(signer.address).toBe(privateKeyToAccount(key).address);
  });
});

// Key-scheme handling needs no fixture, so it runs everywhere.
describe('issuer signer key schemes', () => {
  it('refuses a kms: reference rather than silently signing locally', () => {
    expect(() =>
      createIssuerSigner('kms:arn:aws:kms:eu-west-1:1:key/x'),
    ).toThrow(IssuerKeyError);
  });

  it('refuses a malformed or schemeless key', () => {
    expect(() => createIssuerSigner('0xdeadbeef')).toThrow(IssuerKeyError);
    expect(() =>
      createIssuerSigner('env:not-a-key', { allowPlaintextKey: true }),
    ).toThrow(IssuerKeyError);
  });
});
