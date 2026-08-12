import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';
import { AuthService } from '../services/auth.service';
import { GoogleLoginDto } from '../dtos/google-login.dto';
import { RefreshTokenDto } from '../dtos/refresh-token.dto';
import { AuthTokenResponseDto } from '../dtos/auth-response.dto';
import { IAuthResponse } from '../interfaces/auth-response.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('google')
  @ApiEndpoint({
    summary: 'Authenticate with Google ID token',
    description:
      'Verifies Google ID token and returns access/refresh tokens. Supports iOS, Android, and Web clients.',
    responseType: AuthTokenResponseDto,
    includeAuth: false,
  })
  googleLogin(@Body() dto: GoogleLoginDto): Promise<IAuthResponse> {
    return this.authService.googleLogin(dto.idToken, dto.type);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('refresh')
  @ApiEndpoint({
    summary: 'Refresh access token',
    description:
      'Issues new access and refresh tokens using a valid refresh token',
    responseType: AuthTokenResponseDto,
    includeAuth: false,
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<IAuthResponse> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'End the session',
    description:
      'Revokes the refresh token and every token rotated from the same login.',
    includeAuth: false,
  })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }
}
