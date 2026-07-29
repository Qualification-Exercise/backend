import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { apiError } from '@/common/api-error';
import { Env } from '@/config/env';
import { UsersService } from '@/users/services/users.service';
import { User } from '@/users/entities/user.entity';
import { GoogleTokenVerifierService } from './google-token-verifier.service';
import {
  IJwtPayload,
  IAuthResponse,
} from '../interfaces/auth-response.interface';
import { EErrorCodes } from '@/common/enums/error-codes.enum';

export type { IAuthResponse };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Env>,
    private readonly usersService: UsersService,
    private readonly googleVerifier: GoogleTokenVerifierService,
  ) {}

  async googleLogin(googleToken: string): Promise<IAuthResponse> {
    const profile = await this.googleVerifier.verifyIdToken(googleToken);
    if (!profile.emailVerified) {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.EMAIL_NOT_VERIFIED,
          'Google email is not verified',
        ),
      );
    }

    let user = await this.usersService.findByExternalAuthId(profile.sub);
    if (!user) {
      const existing = await this.usersService.findByEmail(profile.email);
      if (existing) {
        this.logger.warn(
          `security_event=auth.account_linked userId=${existing.id} oldExternalAuthId=${existing.externalAuthId} newExternalAuthId=${profile.sub}`,
        );
        user = await this.usersService.updateExternalAuthId(
          existing.id,
          profile.sub,
        );
      } else {
        user = await this.usersService.create({
          externalAuthId: profile.sub,
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
        });
      }
    }

    return this.buildAuthResponse(user);
  }

  async refreshTokens(refreshToken: string): Promise<IAuthResponse> {
    let payload: IJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<IJwtPayload>(refreshToken, {
        issuer: this.configService.get('AUTH_ISSUER'),
        audience: this.configService.get('AUTH_AUDIENCE'),
      });
    } catch {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_REFRESH_TOKEN,
          'Refresh token is invalid or expired',
        ),
      );
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_REFRESH_TOKEN,
          'Refresh token is invalid or expired',
        ),
      );
    }

    const user = await this.usersService.findByExternalAuthId(payload.sub);
    if (!user)
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_REFRESH_TOKEN,
          'Refresh token is invalid or expired',
        ),
      );

    return this.buildAuthResponse(user);
  }

  private buildAuthResponse(user: User): IAuthResponse {
    const claims = { sub: user.externalAuthId, email: user.email };
    const accessToken = this.jwtService.sign(claims, {
      expiresIn: this.configService.get('JWT_EXPIRATION'),
      issuer: this.configService.get('AUTH_ISSUER'),
      audience: this.configService.get('AUTH_AUDIENCE'),
    });
    const refreshToken = this.jwtService.sign(
      { ...claims, type: 'refresh' },
      {
        expiresIn: this.configService.get('REFRESH_TOKEN_EXPIRATION'),
        issuer: this.configService.get('AUTH_ISSUER'),
        audience: this.configService.get('AUTH_AUDIENCE'),
      },
    );
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
