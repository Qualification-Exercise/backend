import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JwtStrategy } from '@/auth/guards/jwt.strategy';

const ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-value-long-enough-for-hs256',
  AUTH_ISSUER: 'https://auth.test',
  AUTH_AUDIENCE: 'wdk-backend',
};

function build(user: unknown) {
  const findByExternalAuthId = jest.fn(async () => user);
  const strategy = new JwtStrategy(
    { get: (key: string) => ENV[key] } as ConfigService<never>,
    { findByExternalAuthId } as never,
  );
  return { strategy, findByExternalAuthId };
}

describe('JwtStrategy.validate', () => {
  it('resolves the IdP subject to our own user', async () => {
    const { strategy, findByExternalAuthId } = build({
      id: 'user-1',
      externalAuthId: 'dev|local-1',
      email: 'dev@example.com',
    });

    await expect(strategy.validate({ sub: 'dev|local-1' })).resolves.toEqual({
      userId: 'user-1',
      externalAuthId: 'dev|local-1',
      email: 'dev@example.com',
    });
    expect(findByExternalAuthId).toHaveBeenCalledWith('dev|local-1');
  });

  it('rejects a subject we have never seen', async () => {
    const { strategy } = build(null);

    await expect(strategy.validate({ sub: 'stranger' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a refresh token presented as an access token', async () => {
    const { strategy, findByExternalAuthId } = build({
      id: 'user-1',
      externalAuthId: 'dev|local-1',
      email: null,
    });

    await expect(
      strategy.validate({ sub: 'dev|local-1', type: 'refresh' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findByExternalAuthId).not.toHaveBeenCalled();
  });
});
