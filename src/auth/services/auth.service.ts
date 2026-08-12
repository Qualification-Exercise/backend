import { randomUUID } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { apiError } from '@/common/api-error';
import { Env } from '@/config/env';
import { UsersService } from '@/users/services/users.service';
import { User } from '@/users/entities/user.entity';
import { RefreshTokenEntity } from '@/auth/entities/refresh-token.entity';
import { GoogleTokenVerifierService } from './google-token-verifier.service';
import { EClientType } from '../enums/client-type.enum';
import {
  IJwtPayload,
  IAuthResponse,
} from '../interfaces/auth-response.interface';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import { TEST_USER_ID } from '@/database/test-user';

export type { IAuthResponse };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Env>,
    private readonly usersService: UsersService,
    private readonly googleVerifier: GoogleTokenVerifierService,
    @InjectRepository(RefreshTokenEntity)
    private readonly tokens: Repository<RefreshTokenEntity>,
  ) {}

  async googleLogin(
    idToken: string,
    type: EClientType,
  ): Promise<IAuthResponse> {
    const profile = await this.googleVerifier.verifyIdTokenForProfile(
      idToken,
      type,
    );

    const user =
      (await this.usersService.findByExternalAuthId(profile.sub)) ??
      (await this.usersService.create({
        externalAuthId: profile.sub,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
      }));

    return this.issueSession(user);
  }

  async refreshTokens(refreshToken: string): Promise<IAuthResponse> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const stored = payload.jti
      ? await this.tokens.findOne({ where: { jti: payload.jti } })
      : null;
    if (!stored) throw this.invalidRefresh();

    if (stored.usedAt || stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      this.logger.error(
        `security_event=auth.refresh_reuse userId=${stored.userId} ` +
          `family=${stored.familyId} jti=${stored.jti}`,
      );
      throw this.invalidRefresh();
    }

    const user = await this.usersService.findByExternalAuthId(payload.sub);
    if (!user) throw this.invalidRefresh();

    const spent = await this.tokens.update(
      { jti: stored.jti, usedAt: IsNull(), revokedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!spent.affected) {
      await this.revokeFamily(stored.familyId);
      throw this.invalidRefresh();
    }

    return this.issueSession(user, stored.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (payload.familyId) await this.revokeFamily(payload.familyId);
  }

  async generateDevTestToken(): Promise<IAuthResponse> {
    // Second gate: AuthModule only registers the route when the flag is on.
    if (this.configService.get('ENABLE_DEV_TEST_TOKEN') !== true) {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_REQUEST,
          'Test token endpoint is disabled',
        ),
      );
    }

    const user = await this.usersService.findById(TEST_USER_ID);
    if (!user) {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_REQUEST,
          'Test user not found. Run seed first: npm run seed',
        ),
      );
    }

    return this.issueSession(user);
  }

  private async verifyRefreshToken(token: string): Promise<IJwtPayload> {
    let payload: IJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<IJwtPayload>(token, {
        algorithms: ['HS256'],
        issuer: this.configService.get('AUTH_ISSUER'),
        audience: this.configService.get('AUTH_AUDIENCE'),
      });
    } catch {
      throw this.invalidRefresh();
    }
    if (payload.type !== 'refresh') throw this.invalidRefresh();
    return payload;
  }

  private invalidRefresh(): UnauthorizedException {
    return new UnauthorizedException(
      apiError(
        EErrorCodes.INVALID_REFRESH_TOKEN,
        'Refresh token is invalid or expired',
      ),
    );
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.tokens.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async issueSession(
    user: User,
    familyId?: string,
  ): Promise<IAuthResponse> {
    const claims = {
      sub: user.externalAuthId,
      userId: user.id,
      email: user.email ?? undefined,
    };
    const accessToken = this.jwtService.sign(claims, {
      expiresIn: this.configService.get('JWT_EXPIRATION'),
      issuer: this.configService.get('AUTH_ISSUER'),
      audience: this.configService.get('AUTH_AUDIENCE'),
    });

    const jti = randomUUID();
    const ttlSeconds = Number(
      this.configService.get('REFRESH_TOKEN_EXPIRATION'),
    );
    const refreshToken = this.jwtService.sign(
      { ...claims, type: 'refresh', jti, familyId: familyId ?? jti },
      {
        expiresIn: ttlSeconds,
        issuer: this.configService.get('AUTH_ISSUER'),
        audience: this.configService.get('AUTH_AUDIENCE'),
      },
    );

    await this.tokens.insert({
      jti,
      userId: user.id,
      familyId: familyId ?? jti,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }
}
