import { InitSchema1785252463926 } from './1785252463926-InitSchema';
import { PaymentIngestion1785270185648 } from './1785270185648-PaymentIngestion';
import { PriceSnapshots1785272026280 } from './1785272026280-PriceSnapshots';
import { AccrualCoupons1785272858122 } from './1785272858122-AccrualCoupons';
import { AddUserNames1785318619822 } from './1785318619822-AddUserNames';

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
];
