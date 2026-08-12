import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';
import { JwtStrategy } from './guards/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { GoogleTokenVerifierService } from './services/google-token-verifier.service';
import { AuthController } from './controllers/auth.controller';
import { DevAuthController } from './controllers/dev-auth.controller';
import { UsersModule } from '@/users/users.module';
import { RefreshTokenEntity } from '@/auth/entities/refresh-token.entity';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    TypeOrmModule.forFeature([RefreshTokenEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env>) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: configService.get('JWT_EXPIRATION'),
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    AuthService,
    GoogleTokenVerifierService,
  ],
  controllers: [
    AuthController,
    ...(process.env.ENABLE_DEV_TEST_TOKEN === 'true'
      ? [DevAuthController]
      : []),
  ],
  exports: [JwtAuthGuard, AuthService],
})
export class AuthModule {}
