/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleTokenVerifierService } from './google-token-verifier.service';
import { EClientType } from '../enums/client-type.enum';

jest.mock('google-auth-library');

describe('GoogleTokenVerifierService', () => {
  let service: GoogleTokenVerifierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleTokenVerifierService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string | undefined> = {
                GOOGLE_IOS_CLIENT_ID: 'test-ios-client-id',
                GOOGLE_ANDROID_CLIENT_ID: 'test-android-client-id',
                GOOGLE_WEB_CLIENT_ID: 'test-web-client-id',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<GoogleTokenVerifierService>(
      GoogleTokenVerifierService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyIdTokenForProfile', () => {
    it('should return profile with all fields for valid token', async () => {
      const mockTicket = {
        getPayload: jest.fn().mockReturnValue({
          sub: 'google-123',
          email: 'user@google.com',
          email_verified: true,
          given_name: 'John',
          family_name: 'Doe',
        }),
      };

      (service as any).clientConfigs[EClientType.IOS].client.verifyIdToken =
        jest.fn().mockResolvedValue(mockTicket);

      const result = await service.verifyIdTokenForProfile(
        'valid-id-token',
        EClientType.IOS,
      );

      expect(result).toEqual({
        sub: 'google-123',
        email: 'user@google.com',
        emailVerified: true,
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should handle missing name fields as null', async () => {
      const mockTicket = {
        getPayload: jest.fn().mockReturnValue({
          sub: 'google-123',
          email: 'user@google.com',
          email_verified: true,
        }),
      };

      (service as any).clientConfigs[EClientType.ANDROID].client.verifyIdToken =
        jest.fn().mockResolvedValue(mockTicket);

      const result = await service.verifyIdTokenForProfile(
        'valid-id-token',
        EClientType.ANDROID,
      );

      expect(result.firstName).toBeNull();
      expect(result.lastName).toBeNull();
      expect(result.emailVerified).toBe(true);
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      (service as any).clientConfigs[EClientType.WEB].client.verifyIdToken =
        jest.fn().mockRejectedValue(new Error('Invalid token'));

      await expect(
        service.verifyIdTokenForProfile('invalid-token', EClientType.WEB),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.verifyIdTokenForProfile('invalid-token', EClientType.WEB),
      ).rejects.toMatchObject({
        response: { error: { code: 'INVALID_GOOGLE_TOKEN' } },
      });
    });

    it('should throw ServiceUnavailableException for network errors', async () => {
      const error = new Error('getaddrinfo ENOTFOUND');
      (error as any).code = 'ENOTFOUND';
      (service as any).clientConfigs[EClientType.IOS].client.verifyIdToken =
        jest.fn().mockRejectedValue(error);

      await expect(
        service.verifyIdTokenForProfile('token', EClientType.IOS),
      ).rejects.toThrow(ServiceUnavailableException);
      await expect(
        service.verifyIdTokenForProfile('token', EClientType.IOS),
      ).rejects.toMatchObject({
        response: { error: { code: 'GOOGLE_UNAVAILABLE' } },
      });
    });

    it('should throw UnauthorizedException if payload missing sub', async () => {
      const mockTicket = {
        getPayload: jest.fn().mockReturnValue({
          email: 'user@google.com',
        }),
      };

      (service as any).clientConfigs[EClientType.ANDROID].client.verifyIdToken =
        jest.fn().mockResolvedValue(mockTicket);

      await expect(
        service.verifyIdTokenForProfile('token', EClientType.ANDROID),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if payload missing email', async () => {
      const mockTicket = {
        getPayload: jest.fn().mockReturnValue({
          sub: 'google-123',
        }),
      };

      (service as any).clientConfigs[EClientType.WEB].client.verifyIdToken =
        jest.fn().mockResolvedValue(mockTicket);

      await expect(
        service.verifyIdTokenForProfile('token', EClientType.WEB),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should handle ECONNREFUSED as network error', async () => {
      const error = new Error('connect ECONNREFUSED');
      (error as any).code = 'ECONNREFUSED';
      (service as any).clientConfigs[EClientType.IOS].client.verifyIdToken =
        jest.fn().mockRejectedValue(error);

      await expect(
        service.verifyIdTokenForProfile('token', EClientType.IOS),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should handle ETIMEDOUT as network error', async () => {
      const error = new Error('request timeout ETIMEDOUT');
      (error as any).code = 'ETIMEDOUT';
      (service as any).clientConfigs[EClientType.ANDROID].client.verifyIdToken =
        jest.fn().mockRejectedValue(error);

      await expect(
        service.verifyIdTokenForProfile('token', EClientType.ANDROID),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should handle EAI_AGAIN as network error', async () => {
      const error = new Error('getaddrinfo EAI_AGAIN');
      (error as any).code = 'EAI_AGAIN';
      (service as any).clientConfigs[EClientType.WEB].client.verifyIdToken =
        jest.fn().mockRejectedValue(error);

      await expect(
        service.verifyIdTokenForProfile('token', EClientType.WEB),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('web client registration', () => {
    const buildWith = async (webClientId?: string) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoogleTokenVerifierService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(
                (key: string) =>
                  ({
                    GOOGLE_IOS_CLIENT_ID: 'test-ios-client-id',
                    GOOGLE_ANDROID_CLIENT_ID: 'test-android-client-id',
                    GOOGLE_WEB_CLIENT_ID: webClientId,
                  })[key],
              ),
            },
          },
        ],
      }).compile();
      return module.get(GoogleTokenVerifierService);
    };

    it('verifies web tokens against the configured web client id', async () => {
      const web = await buildWith('test-web-client-id');
      const verifyIdToken = jest.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google-123',
          email: 'user@google.com',
          email_verified: true,
        }),
      });
      (web as any).clientConfigs[EClientType.WEB].client.verifyIdToken =
        verifyIdToken;

      await expect(
        web.verifyIdTokenForProfile('token', EClientType.WEB),
      ).resolves.toMatchObject({ sub: 'google-123' });
      // The audience is what binds the token to this application.
      expect(verifyIdToken).toHaveBeenCalledWith({
        idToken: 'token',
        audience: 'test-web-client-id',
      });
    });

    it('refuses web logins when no web client id is configured', async () => {
      // Registering it anyway would leave `audience` undefined, and
      // `verifyIdToken` skips the audience check entirely in that case — a
      // token minted for any other Google app would log the holder in here.
      const web = await buildWith(undefined);

      expect((web as any).clientConfigs[EClientType.WEB]).toBeUndefined();
      await expect(
        web.verifyIdTokenForProfile('token', EClientType.WEB),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
