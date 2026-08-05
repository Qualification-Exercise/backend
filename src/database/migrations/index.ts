import { InitSchema1785252463926 } from './1785252463926-InitSchema';
import { PaymentIngestion1785270185648 } from './1785270185648-PaymentIngestion';
import { PriceSnapshots1785272026280 } from './1785272026280-PriceSnapshots';
import { AccrualCoupons1785272858122 } from './1785272858122-AccrualCoupons';
import { AddUserNames1785318619822 } from './1785318619822-AddUserNames';
import { DocSchemaAlignment1785404000000 } from './1785404000000-DocSchemaAlignment';
import { ClaimStateMachine1785500000000 } from './1785500000000-ClaimStateMachine';
import { ClaimFailureDetail1785600000000 } from './1785600000000-ClaimFailureDetail';
import { Signers1785700000000 } from './1785700000000-Signers';
import { EventCursors1785800000000 } from './1785800000000-EventCursors';
import { ServiceCounters1785900000000 } from './1785900000000-ServiceCounters';
import { ClaimChallenges1786000000000 } from './1786000000000-ClaimChallenges';
import { BalanceCache1786100000000 } from './1786100000000-BalanceCache';
import { SeedSigners1786200000000 } from './1786200000000-SeedSigners';
import { BalanceCacheUserRelation1786300000000 } from './1786300000000-BalanceCacheUserRelation';

/**
 * Listed explicitly, not globbed: `nest build` bundles the app into a single
 * dist/main.js, so no migration files exist on disk at runtime for a glob to
 * find. Add every generated migration here or it will never run.
 */
export const migrations = [
  InitSchema1785252463926,
  PaymentIngestion1785270185648,
  PriceSnapshots1785272026280,
  AccrualCoupons1785272858122,
  AddUserNames1785318619822,
  DocSchemaAlignment1785404000000,
  ClaimStateMachine1785500000000,
  ClaimFailureDetail1785600000000,
  Signers1785700000000,
  EventCursors1785800000000,
  ServiceCounters1785900000000,
  ClaimChallenges1786000000000,
  BalanceCache1786100000000,
  SeedSigners1786200000000,
  BalanceCacheUserRelation1786300000000,
];
