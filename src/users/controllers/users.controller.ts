import { Controller, Get } from '@nestjs/common';
import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { UsersService } from '../services/users.service';
import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiEndpoint({
    summary: 'Get current user profile',
    description: 'Returns the profile of the currently authenticated user',
  })
  async me(@CurrentUser() authUser: IAuthUser) {
    const user = await this.usersService.findById(authUser.userId);
    return {
      id: user!.id,
      email: user!.email,
      firstName: user!.firstName,
      lastName: user!.lastName,
    };
  }
}
