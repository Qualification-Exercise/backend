import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

import { recoverTypedDataAddress, type Hex } from 'viem';

import { ENTITLEMENT_TYPES, entitlementDomain } from '@/issuer/entitlement';
import { createIssuerSigner } from '@/issuer/signer';

async function main() {
  const fixture = JSON.parse(
    readFileSync(
      process.env.ENTITLEMENT_FIXTURE ??
        resolve(__dirname, '../../contract/test/fixtures/entitlement.json'),
      'utf8',
    ),
  );

  const signer = createIssuerSigner(process.env.ISSUER_SIGNING_KEY ?? '', {
    password: process.env.SIGNER_KEY_PASSWORD,
    allowPlaintextKey: process.env.NODE_ENV === 'development',
  });

  const domain = {
    chainId: fixture.domain.chainId as number,
    verifyingContract: fixture.domain.verifyingContract as Hex,
  };
  const message = {
    recipient: fixture.message.recipient as Hex,
    amount: BigInt(fixture.message.amount),
    paymentRef: fixture.message.paymentRef as Hex,
    deadline: BigInt(fixture.message.deadline),
  };

  const signature = await signer.signEntitlement(domain, message);
  const recovered = await recoverTypedDataAddress({
    domain: entitlementDomain(domain),
    types: ENTITLEMENT_TYPES,
    primaryType: 'Entitlement',
    message,
    signature,
  });

  assert.equal(
    recovered.toLowerCase(),
    signer.address.toLowerCase(),
    'WDK signature does not recover to the issuer address',
  );

  console.log(`signer      : ${signer.address}`);
  console.log(`digest      : ${fixture.digest}`);
  console.log(`signature   : ${signature}`);
  console.log('wdk-wallet-evm signature recovers to the issuer address: OK');
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
