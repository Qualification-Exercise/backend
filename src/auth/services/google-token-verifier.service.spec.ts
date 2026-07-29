import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleTokenVerifierService } from './google-token-verifier.service';

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
              if (key === 'GOOGLE_CLIENT_ID') return 'test-client-id';
              return undefined;
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

  describe('verifyIdToken', () => {
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

      (service as any).client.verifyIdToken = jest
        .fn()
        .mockResolvedValue(mockTicket);

      const result = await service.verifyIdToken('valid-token');

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
          email_verified: false,
        }),
      };

      (service as any).client.verifyIdToken = jest
        .fn()
        .mockResolvedValue(mockTicket);

      const result = await service.verifyIdToken('valid-token');

      expect(result.firstName).toBeNull();
      expect(result.lastName).toBeNull();
      expect(result.emailVerified).toBeFalsy();
    });

    it('should throw UnauthorizedException for invalid token signature', async () => {
      (service as any).client.verifyIdToken = jest
        .fn()
        .mockRejectedValue(new Error('Invalid signature'));

      await expect(service.verifyIdToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(
        service.verifyIdToken('invalid-token'),
      ).rejects.toMatchObject({
        response: { error: { code: 'INVALID_GOOGLE_TOKEN' } },
      });
    });

    it('should throw ServiceUnavailableException for network errors', async () => {
      (service as any).client.verifyIdToken = jest
        .fn()
        .mockRejectedValue({ code: 'ENOTFOUND' });

      await expect(service.verifyIdToken('token')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.verifyIdToken('token')).rejects.toMatchObject({
        response: { error: { code: 'GOOGLE_UNAVAILABLE' } },
      });
    });

    it('should throw UnauthorizedException if payload missing sub', async () => {
      const mockTicket = {
        getPayload: jest.fn().mockReturnValue({
          email: 'user@google.com',
        }),
      };

      (service as any).client.verifyIdToken = jest
        .fn()
        .mockResolvedValue(mockTicket);

      await expect(service.verifyIdToken('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if payload missing email', async () => {
      const mockTicket = {
        getPayload: jest.fn().mockReturnValue({
          sub: 'google-123',
        }),
      };

      (service as any).client.verifyIdToken = jest
        .fn()
        .mockResolvedValue(mockTicket);

      await expect(service.verifyIdToken('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle ECONNREFUSED as network error', async () => {
      (service as any).client.verifyIdToken = jest
        .fn()
        .mockRejectedValue({ code: 'ECONNREFUSED' });

      await expect(service.verifyIdToken('token')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should handle ETIMEDOUT as network error', async () => {
      (service as any).client.verifyIdToken = jest
        .fn()
        .mockRejectedValue({ code: 'ETIMEDOUT' });

      await expect(service.verifyIdToken('token')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should handle EAI_AGAIN as network error', async () => {
      (service as any).client.verifyIdToken = jest
        .fn()
        .mockRejectedValue({ code: 'EAI_AGAIN' });

      await expect(service.verifyIdToken('token')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
