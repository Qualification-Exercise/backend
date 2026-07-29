import { Body, Controller, Post } from '@nestjs/common';
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

  @Post('dev/test-token')
  @ApiEndpoint({
    summary: 'Generate test token (development only)',
    description:
      'Issues test tokens for development. Only available in dev mode.',
    responseType: AuthTokenResponseDto,
    includeAuth: false,
  })
  testToken(): Promise<IAuthResponse> {
    return this.authService.generateDevTestToken();
  }
}
