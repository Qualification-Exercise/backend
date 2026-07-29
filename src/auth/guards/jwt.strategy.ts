import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';
import { UsersService } from '@/users/services/users.service';
import type { IAuthUser } from '@/auth/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<Env>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET')!,
      issuer: configService.get('AUTH_ISSUER'),
      audience: configService.get('AUTH_AUDIENCE'),
    });
  }

  // Resolves the IdP `sub` to our internal user ID; unknown `sub`s are unauthorized, as user creation belongs to the auth session flow.
  async validate(payload: {
    sub: string;
    email?: string;
    type?: string;
  }): Promise<IAuthUser> {
    if (payload.type === 'refresh') throw new UnauthorizedException();

    const user = await this.usersService.findByExternalAuthId(payload.sub);
    if (!user) throw new UnauthorizedException();

    return {
      userId: user.id,
      externalAuthId: user.externalAuthId,
      email: user.email,
    };
  }
}
