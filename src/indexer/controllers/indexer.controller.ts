import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';
import { IndexerService } from '@/indexer/services/indexer.service';
import type { ITransfer } from '@/indexer/interfaces/indexer.interface';
import { GetTokenTransfersDto } from '@/indexer/dtos/get-token-transfers.dto';
import { TokenTransferResponseDto } from '@/indexer/dtos/token-transfer.response.dto';

@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) {}

  @Get(':blockchain/:token/:address/token-transfers')
  @Throttle({ default: { limit: 8, ttl: 10000 } })
  @ApiEndpoint({
    summary: 'Fetch token transfers for an address',
    description: 'Query WDK indexer for token transfer history',
    responseSchemas: [TokenTransferResponseDto],
    includeAuth: false,
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
}
