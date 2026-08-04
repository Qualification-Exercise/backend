import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CreateTransactionDTO } from '@/transactions/dtos/create-transaction.dto';
import { ListTransactionsDTO } from '@/transactions/dtos/list-transactions.dto';
import { TransactionsService } from '@/transactions/services/transactions.service';

const ONE_HOUR_MS = 3_600_000;

@Controller('transactions')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@CurrentUser() user: IAuthUser, @Query() query: ListTransactionsDTO) {
    return this.transactionsService.list(user.userId, query);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: ONE_HOUR_MS } })
  async record(
    @CurrentUser() user: IAuthUser,
    @Body() dto: CreateTransactionDTO,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const { item, created } = await this.transactionsService.record(
      user.userId,
      dto,
      idempotencyKey,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return item;
  }

  @Get(':id')
  findById(@CurrentUser() user: IAuthUser, @Param('id') id: string) {
    return this.transactionsService.findById(user.userId, id);
  }
}
