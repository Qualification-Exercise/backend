import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { apiError } from '@/common/api-error';
import { Env } from '@/config/env';
import { IGoogleProfile } from '../interfaces/google-profile.interface';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import { EClientType } from '../enums/client-type.enum';

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

interface ClientConfig {
  id: string;
  client: OAuth2Client;
}

@Injectable()
export class GoogleTokenVerifierService {
  private readonly logger = new Logger(GoogleTokenVerifierService.name);
  private readonly clientConfigs: Partial<Record<EClientType, ClientConfig>>;

  constructor(configService: ConfigService<Env>) {
    const webClientId = configService.get('GOOGLE_WEB_CLIENT_ID');

    this.clientConfigs = {
      [EClientType.IOS]: {
        id: configService.get('GOOGLE_IOS_CLIENT_ID')!,
        client: new OAuth2Client(configService.get('GOOGLE_IOS_CLIENT_ID')!),
      },
      [EClientType.ANDROID]: {
        id: configService.get('GOOGLE_ANDROID_CLIENT_ID')!,
        client: new OAuth2Client(
          configService.get('GOOGLE_ANDROID_CLIENT_ID')!,
        ),
      },
    };

    if (webClientId) {
      this.clientConfigs[EClientType.WEB] = {
        id: webClientId,
        client: new OAuth2Client(webClientId),
      };
    }
  }

  private getConfigForType(type: EClientType): ClientConfig {
    const config = this.clientConfigs[type];
    if (!config) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.INVALID_REQUEST,
          `Client type '${type}' is not configured`,
        ),
      );
    }
    return config;
  }

  async verifyIdTokenForProfile(
    idToken: string,
    type: EClientType,
  ): Promise<IGoogleProfile> {
    const config = this.getConfigForType(type);

    let ticket;
    try {
      ticket = await config.client.verifyIdToken({
        idToken,
        audience: config.id,
      });
    } catch (err) {
      if (isNetworkError(err)) {
        this.logger.error(
          `Google verification network error: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException(
          apiError(
            EErrorCodes.GOOGLE_UNAVAILABLE,
            'Could not reach Google to verify token',
          ),
        );
      }
      this.logger.warn(`Invalid Google ID token for type=${type}`);
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_GOOGLE_TOKEN,
          'Google ID token is invalid or expired',
        ),
      );
    }

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.INVALID_GOOGLE_TOKEN,
          'Google ID token is invalid or expired',
        ),
      );
    }

    if (!payload.email_verified) {
      throw new UnauthorizedException(
        apiError(
          EErrorCodes.EMAIL_NOT_VERIFIED,
          'Google email is not verified',
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
