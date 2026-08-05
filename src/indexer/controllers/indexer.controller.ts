import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';
import { IndexerService } from '@/indexer/services/indexer.service';
import type {
  ITransfer,
  IBalance,
} from '@/indexer/interfaces/indexer.interface';
import { GetTokenTransfersDto } from '@/indexer/dtos/get-token-transfers.dto';
import { TokenTransfersResponseDto } from '@/indexer/dtos/token-transfer.response.dto';
import { TokenBalanceWrapperResponseDto } from '@/indexer/dtos/token-balance.response.dto';

@ApiTags('indexer')
@ApiParam({
  name: 'blockchain',
  description: 'Chain name',
  example: 'ethereum',
})
@ApiParam({ name: 'token', description: 'Token symbol', example: 'usdt' })
@ApiParam({
  name: 'address',
  description: 'Wallet address',
  example: '0xdac17f958d2ee523a2206206994597c13d831ec7',
})
@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) {}

  @Get(':blockchain/:token/:address/token-transfers')
  @Throttle({ default: { limit: 8, ttl: 10000 } })
  @ApiEndpoint({
    summary: 'Fetch token transfers for an address',
    description:
      'Passthrough to the WDK indexer, newest first. Timestamps are milliseconds. Rate limit: 8 per 10s.',
    responseType: TokenTransfersResponseDto,
    includeAuth: true,
  })
  async getTokenTransfers(
    @Param('blockchain') blockchain: string,
    @Param('token') token: string,
    @Param('address') address: string,
    @Query() query: GetTokenTransfersDto,
  ): Promise<{ transfers: ITransfer[] }> {
    return this.indexerService.tokenTransfers({
      blockchain,
      token,
      address,
      limit: parseInt(query.limit, 10),
      fromTs: query.fromTs ? parseInt(query.fromTs, 10) : undefined,
      toTs: query.toTs ? parseInt(query.toTs, 10) : undefined,
    });
  }

  @Get(':blockchain/:token/:address/token-balances')
  @Throttle({ default: { limit: 4, ttl: 10000 } })
  @ApiEndpoint({
    summary: 'Get current token balance for an address',
    description:
      'Passthrough to the WDK indexer. Prefer `GET /balances` for user-facing screens — it is cached. Rate limit: 4 per 10s.',
    responseType: TokenBalanceWrapperResponseDto,
    includeAuth: true,
  })
  async getTokenBalance(
    @Param('blockchain') blockchain: string,
    @Param('token') token: string,
    @Param('address') address: string,
  ): Promise<{ tokenBalance: IBalance }> {
    return this.indexerService.tokenBalance({
      blockchain,
      token,
      address,
    });
  }
}
