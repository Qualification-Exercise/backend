import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MONITOR_DIR = resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('monitor isolation', () => {
  it('reconciles against its own node, never the Indexer API', () => {
    const forbidden =
      /from ['"]@\/indexer|IndexerService|INDEXER_BASE_URL|INDEXER_API_KEY/;
    const offenders = sourceFiles(MONITOR_DIR).filter((path) =>
      forbidden.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('holds the guardian key and no other', () => {
    const otherKeys = /ISSUER_SIGNING_KEY|RELAYER_SIGNING_KEY/;
    const offenders = sourceFiles(MONITOR_DIR).filter((path) =>
      otherKeys.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('writes nothing to the pipeline it watches', () => {
    const writes =
      /(coupons|claims|payments|attestations|settlements)\.(insert|save|update|delete|upsert)/;
    const offenders = sourceFiles(MONITOR_DIR).filter((path) =>
      writes.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('has no controllers — nothing can call in', () => {
    const offenders = sourceFiles(MONITOR_DIR).filter((path) =>
      /@Controller|@Get\(|@Post\(/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
