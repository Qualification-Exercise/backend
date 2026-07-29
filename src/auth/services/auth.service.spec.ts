import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleTokenVerifierService } from './google-token-verifier.service';
import { UsersService } from '@/users/services/users.service';
import { User } from '@/users/entities/user.entity';
import { EClientType } from '../enums/client-type.enum';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let usersService: UsersService;
  let googleVerifier: GoogleTokenVerifierService;

  beforeEach(async () => {
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
            findByEmail: jest.fn(),
            create: jest.fn(),
            updateExternalAuthId: jest.fn(),
          },
        },
        {
          provide: GoogleTokenVerifierService,
          useValue: {
            verifyIdTokenForProfile: jest.fn(),
          },
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
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);
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

    it('should return tokens for existing user by externalAuthId', async () => {
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
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(existingUser);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      const result = await service.googleLogin('id-token', EClientType.ANDROID);

      expect(result.user.id).toBe('existing-user-id');
      expect(usersService.create).not.toHaveBeenCalled();
      expect(usersService.updateExternalAuthId).not.toHaveBeenCalled();
    });

    it('should link accounts and log security event when email exists under different externalAuthId', async () => {
      const existingUser = {
        id: 'existing-user-id',
        externalAuthId: 'auth0-456',
        email: 'test@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      } as User;

      const linkedUser = {
        ...existingUser,
        externalAuthId: 'google-123',
      } as User;

      jest
        .spyOn(googleVerifier, 'verifyIdTokenForProfile')
        .mockResolvedValue(googleProfile);
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(existingUser);
      jest
        .spyOn(usersService, 'updateExternalAuthId')
        .mockResolvedValue(linkedUser);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');
      const loggerSpy = jest.spyOn(service['logger'], 'warn');

      const result = await service.googleLogin('id-token', EClientType.WEB);

      expect(result.user.id).toBe('existing-user-id');
      expect(usersService.updateExternalAuthId).toHaveBeenCalledWith(
        'existing-user-id',
        'google-123',
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('security_event=auth.account_linked'),
      );
    });

    it('should reject unverified email from verifier', async () => {
      jest
        .spyOn(googleVerifier, 'verifyIdTokenForProfile')
        .mockRejectedValue(new UnauthorizedException('Email is not verified'));

      await expect(
        service.googleLogin('id-token', EClientType.IOS),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.findByEmail).not.toHaveBeenCalled();
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

  describe('buildAuthResponse', () => {
    it('should generate tokens with correct claims and expirations', async () => {
      const user = {
        id: 'user-id',
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      } as User;

      const signSpy = jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      (service as any).buildAuthResponse(user);

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
        },
        {
          expiresIn: 604800,
          issuer: 'https://test.example.com',
          audience: 'test-audience',
        },
      );
    });
  });
});
