import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { apiError } from '@/common/api-error';
import { Env } from '@/config/env';
import { IGoogleProfile } from '../interfaces/google-profile.interface';
import { EErrorCodes } from '@/common/enums/error-codes.enum';

function isNetworkError(err: unknown): boolean {
  const networkErrorCodes = [
    'ENOTFOUND',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
  ];
  const code = (err as { code?: string })?.code;
  return code ? networkErrorCodes.includes(code) : false;
}

@Injectable()
export class GoogleTokenVerifierService {
  private readonly client: OAuth2Client;
  private readonly googleClientId: string;

  constructor(configService: ConfigService<Env>) {
    this.googleClientId = configService.get('GOOGLE_CLIENT_ID')!;
    this.client = new OAuth2Client(this.googleClientId);
  }

  async verifyIdToken(idToken: string): Promise<IGoogleProfile> {
    let ticket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
    } catch (err) {
      if (isNetworkError(err)) {
        throw new ServiceUnavailableException(
          apiError(
            EErrorCodes.GOOGLE_UNAVAILABLE,
            'Could not reach Google to verify token',
          ),
        );
      }
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_GOOGLE_TOKEN,
          'Google token is invalid or expired',
        ),
      );
    }

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_GOOGLE_TOKEN,
          'Google token is invalid or expired',
        ),
      );
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified ?? false,
      firstName: payload.given_name ?? null,
      lastName: payload.family_name ?? null,
    };
  }
}
