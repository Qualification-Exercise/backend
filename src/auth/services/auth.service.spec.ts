import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleTokenVerifierService } from './google-token-verifier.service';
import { UsersService } from '@/users/services/users.service';
import { User } from '@/users/entities/user.entity';
import { EClientType } from '../enums/client-type.enum';
import { RefreshTokenEntity } from '@/auth/entities/refresh-token.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('AuthService', () => {
  let service: AuthService;
  let tokens: {
    findOne: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
  };
  let jwtService: JwtService;
  let usersService: UsersService;
  let googleVerifier: GoogleTokenVerifierService;

  beforeEach(async () => {
    // Rotation state: refresh tokens are rows now, and the default row is a
    // live, unspent one so the happy path reads naturally.
    tokens = {
      findOne: jest.fn(async () => ({
        jti: 'jti-1',
        userId: 'user-id',
        familyId: 'fam-1',
        usedAt: null,
        revokedAt: null,
      })),
      insert: jest.fn(async () => undefined),
      update: jest.fn(async () => ({ affected: 1 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string | number> = {
                JWT_EXPIRATION: 3600,
                REFRESH_TOKEN_EXPIRATION: 604800,
                AUTH_ISSUER: 'https://test.example.com',
                AUTH_AUDIENCE: 'test-audience',
              };
              return config[key];
            }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByExternalAuthId: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: GoogleTokenVerifierService,
          useValue: {
            verifyIdTokenForProfile: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RefreshTokenEntity),
          useValue: tokens,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    usersService = module.get<UsersService>(UsersService);
    googleVerifier = module.get<GoogleTokenVerifierService>(
      GoogleTokenVerifierService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('googleLogin', () => {
    const googleProfile = {
      sub: 'google-123',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'John',
      lastName: 'Doe',
    };

    it('should create new user and return tokens on first login', async () => {
      const newUser = {
        id: 'new-user-id',
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      } as User;

      jest
        .spyOn(googleVerifier, 'verifyIdTokenForProfile')
        .mockResolvedValue(googleProfile);
      jest.spyOn(usersService, 'findByExternalAuthId').mockResolvedValue(null);
      jest.spyOn(usersService, 'create').mockResolvedValue(newUser);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      const result = await service.googleLogin('id-token', EClientType.IOS);

      expect(result).toEqual({
        accessToken: 'token',
        refreshToken: 'token',
        user: {
          id: 'new-user-id',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
      });
      expect(usersService.create).toHaveBeenCalledWith({
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should return tokens for the existing user with that IdP subject', async () => {
      const existingUser = {
        id: 'existing-user-id',
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      } as User;

      jest
        .spyOn(googleVerifier, 'verifyIdTokenForProfile')
        .mockResolvedValue(googleProfile);
      jest
        .spyOn(usersService, 'findByExternalAuthId')
        .mockResolvedValue(existingUser);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      const result = await service.googleLogin('id-token', EClientType.ANDROID);

      expect(result.user.id).toBe('existing-user-id');
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('does not let a second IdP subject take over an existing email', async () => {
      const created = {
        id: 'new-user-id',
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      } as User;

      jest
        .spyOn(googleVerifier, 'verifyIdTokenForProfile')
        .mockResolvedValue(googleProfile);
      // Someone already signed up with this email under another provider.
      jest.spyOn(usersService, 'findByExternalAuthId').mockResolvedValue(null);
      jest.spyOn(usersService, 'create').mockResolvedValue(created);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      const result = await service.googleLogin('id-token', EClientType.WEB);

      // A separate account, not the other subject's account.
      expect(result.user.id).toBe('new-user-id');
    });

    it('should reject unverified email from verifier', async () => {
      jest
        .spyOn(googleVerifier, 'verifyIdTokenForProfile')
        .mockRejectedValue(new UnauthorizedException('Email is not verified'));

      await expect(
        service.googleLogin('id-token', EClientType.IOS),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.findByExternalAuthId).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    const user = {
      id: 'user-id',
      externalAuthId: 'google-123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    } as User;

    it('should return new tokens for valid refresh token', async () => {
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: 'google-123',
        userId: 'user-id',
        email: 'test@example.com',
        type: 'refresh',
        jti: 'jti-1',
        familyId: 'fam-1',
      } as never);
      jest.spyOn(usersService, 'findByExternalAuthId').mockResolvedValue(user);
      jest.spyOn(jwtService, 'sign').mockReturnValue('new-token');

      const result = await service.refreshTokens('refresh-token');

      expect(result).toEqual({
        accessToken: 'new-token',
        refreshToken: 'new-token',
        user: {
          id: 'user-id',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
      });
    });

    it('should reject access token when used as refresh token', async () => {
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: 'google-123',
        userId: 'user-id',
        email: 'test@example.com',
        type: undefined,
      } as never);

      await expect(service.refreshTokens('access-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersService.findByExternalAuthId).not.toHaveBeenCalled();
    });

    it('should reject token with type=access', async () => {
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: 'google-123',
        userId: 'user-id',
        email: 'test@example.com',
        type: 'access',
      } as never);

      await expect(service.refreshTokens('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject expired refresh token', async () => {
      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockRejectedValue(new Error('Token expired'));

      await expect(service.refreshTokens('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject if user not found by externalAuthId', async () => {
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: 'google-123',
        userId: 'user-id',
        email: 'test@example.com',
        type: 'refresh',
      } as never);
      jest.spyOn(usersService, 'findByExternalAuthId').mockResolvedValue(null);

      await expect(service.refreshTokens('refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('issueSession', () => {
    it('should generate tokens with correct claims and expirations', async () => {
      const user = {
        id: 'user-id',
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      } as User;

      const signSpy = jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).issueSession(user);

      expect(signSpy).toHaveBeenCalledTimes(2);

      // First call: access token
      expect(signSpy).toHaveBeenNthCalledWith(
        1,
        { sub: 'google-123', userId: 'user-id', email: 'test@example.com' },
        {
          expiresIn: 3600,
          issuer: 'https://test.example.com',
          audience: 'test-audience',
        },
      );

      // Second call: refresh token
      expect(signSpy).toHaveBeenNthCalledWith(
        2,
        {
          sub: 'google-123',
          userId: 'user-id',
          email: 'test@example.com',
          type: 'refresh',
          jti: expect.any(String),
          familyId: expect.any(String),
        },
        {
          expiresIn: 604800,
          issuer: 'https://test.example.com',
          audience: 'test-audience',
        },
      );
    });
  });

  describe('rotation', () => {
    const user = { id: 'user-id', externalAuthId: 'google-123' } as User;

    const presentRefresh = () => {
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: 'google-123',
        userId: 'user-id',
        type: 'refresh',
        jti: 'jti-1',
        familyId: 'fam-1',
      } as never);
      jest.spyOn(usersService, 'findByExternalAuthId').mockResolvedValue(user);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');
    };

    it('spends the presented token so it cannot be exchanged twice', async () => {
      presentRefresh();

      await service.refreshTokens('refresh-token');

      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ jti: 'jti-1' }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
      expect(tokens.insert).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
      );
    });

    it('kills the whole family when a spent token comes back', async () => {
      presentRefresh();
      tokens.findOne.mockResolvedValueOnce({
        jti: 'jti-1',
        userId: 'user-id',
        familyId: 'fam-1',
        usedAt: new Date(),
        revokedAt: null,
      });

      await expect(service.refreshTokens('refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(tokens.insert).not.toHaveBeenCalled();
    });

    it('logout revokes the family behind the token', async () => {
      presentRefresh();

      await service.logout('refresh-token');

      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });
});
