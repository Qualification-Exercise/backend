import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import {
  ADMIN_KEY_HEADER,
  AdminKeyGuard,
} from '@/common/guards/admin-key.guard';

function contextWith(presented?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name === ADMIN_KEY_HEADER ? presented : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

function guardWith(configured: string): AdminKeyGuard {
  return new AdminKeyGuard({
    get: () => configured,
  } as unknown as ConstructorParameters<typeof AdminKeyGuard>[0]);
}

describe('AdminKeyGuard', () => {
  it('lets the right key through', () => {
    expect(guardWith('s3cret').canActivate(contextWith('s3cret'))).toBe(true);
  });

  it('rejects a wrong key', () => {
    expect(() => guardWith('s3cret').canActivate(contextWith('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing header', () => {
    expect(() => guardWith('s3cret').canActivate(contextWith())).toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed when no key is configured', () => {
    // The dangerous bug is the opposite: an unset key comparing equal to an
    // absent header would open merchant registration to the internet.
    expect(() => guardWith('').canActivate(contextWith())).toThrow(
      UnauthorizedException,
    );
    expect(() => guardWith('').canActivate(contextWith(''))).toThrow(
      UnauthorizedException,
    );
  });

  it('does not throw on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths; that must surface as a 401.
    expect(() =>
      guardWith('s3cret').canActivate(contextWith('much-longer-key')),
    ).toThrow(UnauthorizedException);
  });
});
