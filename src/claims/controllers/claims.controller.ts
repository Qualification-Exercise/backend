import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CreateClaimDTO } from '@/claims/dtos/create-claim.dto';
import { ClaimsService } from '@/claims/services/claims.service';

@Controller('claims')
@UseGuards(JwtAuthGuard)
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: IAuthUser,
    @Body() dto: CreateClaimDTO,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.claimsService.create(user.userId, dto, idempotencyKey);
  }

  @Get(':id')
  findById(@CurrentUser() user: IAuthUser, @Param('id') id: string) {
    return this.claimsService.findById(user.userId, id);
  }
}
