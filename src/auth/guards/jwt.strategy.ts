import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<Env>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET')!,
      issuer: configService.get('AUTH_ISSUER'),
      audience: configService.get('AUTH_AUDIENCE'),
    });
  }

  async validate(payload: any) {

    // TODO: implement user lookup/creation logic in validate
    // The payload contains:
    // - sub: external user ID from auth provider
    // - email: user email
    // - other provider-specific claims
    return {
      userId: payload.sub,
      email: payload.email,
      ...payload,
    };
  }
}
