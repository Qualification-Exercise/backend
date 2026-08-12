import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';

import { AuthService } from '../services/auth.service';
import { AuthTokenResponseDto } from '../dtos/auth-response.dto';
import { IAuthResponse } from '../interfaces/auth-response.interface';

@ApiTags('auth')
@Controller('auth')
export class DevAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('dev/test-token')
  @ApiEndpoint({
    summary: 'Generate test token (development only)',
    description:
      'Issues test tokens for development. Registered only when ENABLE_DEV_TEST_TOKEN=true.',
    responseType: AuthTokenResponseDto,
    includeAuth: false,
  })
  testToken(): Promise<IAuthResponse> {
    return this.authService.generateDevTestToken();
  }
}
