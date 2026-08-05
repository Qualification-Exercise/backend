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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

@ApiTags('transactions')
@ApiBearerAuth('jwt')
@Controller('transactions')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my transactions',
    description: 'Cursor-paginated; filterable by chain, type and status.',
  })
  list(@CurrentUser() user: IAuthUser, @Query() query: ListTransactionsDTO) {
    return this.transactionsService.list(user.userId, query);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: ONE_HOUR_MS } })
  @ApiOperation({
    summary: 'Record an on-chain payment',
    description:
      'Registers a broadcast transaction for confirmation tracking; once it reaches the configured depth a cashback coupon is issued. Rate limit: 30/hour.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Repeat with the same key to get the first result back instead of a duplicate record',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Newly recorded' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Already recorded — existing transaction returned',
  })
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
  @ApiOperation({ summary: 'Get one of my transactions' })
  @ApiParam({ name: 'id', description: 'Transaction UUID', format: 'uuid' })
  findById(@CurrentUser() user: IAuthUser, @Param('id') id: string) {
    return this.transactionsService.findById(user.userId, id);
  }
}
