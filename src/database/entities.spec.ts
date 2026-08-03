import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ENTITIES } from '@/database/entities';

const SRC = resolve(__dirname, '..');

function entityFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entityFiles(path);
    return path.endsWith('.entity.ts') ? [path] : [];
  });
}

/**
 * A new entity that is not in the list boots fine until something relates to
 * it, then fails at start-up with "Entity metadata for X#y was not found" — in
 * whichever worker happened to touch that relation first. Cheaper to fail here.
 */
describe('entity registry', () => {
  it('lists every entity file on disk', () => {
    const onDisk = entityFiles(SRC)
      .map((path) => path.split('/').pop()!.replace('.entity.ts', ''))
      .sort();

    const registered = ENTITIES.map((entity) =>
      entity.name
        // ClaimEntity -> claim, WalletChallenge -> wallet-challenge
        .replace(/Entity$/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase(),
    ).sort();

    expect(registered).toEqual(onDisk);
  });
});
