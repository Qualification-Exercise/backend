import { readdirSync } from 'node:fs';
import { migrations } from './index';

describe('migrations barrel', () => {
  it('lists every migration file on disk', () => {
    const onDisk = readdirSync(__dirname)
      .filter((f) => /^\d+-.+\.ts$/.test(f))
      .map((f) => f.replace(/^(\d+)-(.+)\.ts$/, '$2$1'));

    expect(migrations.map((m) => m.name).sort()).toEqual(onDisk.sort());
  });
});
