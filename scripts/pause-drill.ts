import 'dotenv/config';

import { ConfigService } from '@nestjs/config';

import { AlertService } from '@/common/alerts/alert.service';
import { validateEnv } from '@/config/env';
import { MonitorConfig } from '@/monitor/monitor-config';
import { PauserService } from '@/monitor/services/pauser.service';

/**
 * The pause drill (BE-17): exercise the guardian path against a real testnet
 * deployment, because "we could pause if we had to" is not a control until
 * someone has done it.
 *
 *   MONITOR_ENV_FILE=.env.monitor npm run monitor:pause-drill          # pause
 *   MONITOR_ENV_FILE=.env.monitor npm run monitor:pause-drill -- --unpause
 *   MONITOR_ENV_FILE=.env.monitor npm run monitor:pause-drill -- --check
 *
 * `--check` only reports whether the key holds PAUSER_ROLE and whether the
 * contract is paused; it sends nothing.
 *
 * WARNING: pausing stops every claim until it is unpaused. On a shared demo
 * deployment, tell the people demoing it first.
 */
async function main() {
  const env = validateEnv(process.env);
  const configService = new ConfigService(env);
  const config = new MonitorConfig(configService as never);
  const alerts = new AlertService(configService as never);
  const pauser = new PauserService(config, alerts);

  await pauser.assertCanPause();
  const pausedBefore = await pauser.isPaused();
  console.log(`guardian : ${config.signer.address}`);
  console.log(`contract : ${config.couponClaim}`);
  console.log(`paused   : ${pausedBefore}`);

  if (process.argv.includes('--check')) return;

  if (process.argv.includes('--unpause')) {
    throw new Error(
      'unpause is not automated: it is a deliberate human decision, ' +
        'and the governor multisig is the right place for it',
    );
  }

  if (pausedBefore) {
    console.log('Already paused — nothing to drill.');
    return;
  }
  if (!config.autoPause) {
    throw new Error(
      'Set MONITOR_AUTO_PAUSE=true for the drill: the drill exercises the real path',
    );
  }

  await pauser.pause('drill', 'BE-17 pause drill on testnet');
  console.log(`paused   : ${await pauser.isPaused()}`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
