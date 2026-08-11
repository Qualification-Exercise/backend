import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { EChainKind } from '@/chains/chain-kind.enum';
import { ETxStatus, ETxType } from '@/transactions/enums/tx.enum';

export class ListTransactionsDTO {
  @ApiPropertyOptional({ enum: EChainKind, description: 'Filter by chain' })
  @IsOptional()
  @IsEnum(EChainKind)
  chain?: EChainKind;

  @ApiPropertyOptional({ description: 'Filter by source chain id', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  srcChainId?: number;

  @ApiPropertyOptional({ enum: ETxType })
  @IsOptional()
  @IsEnum(ETxType)
  type?: ETxType;

  @ApiPropertyOptional({
    enum: ['in', 'out'],
    description: 'Filter by direction: received (in) or sent (out)',
  })
  @IsOptional()
  @IsIn(['in', 'out'])
  direction?: 'in' | 'out';

  @ApiPropertyOptional({ enum: ETxStatus })
  @IsOptional()
  @IsEnum(ETxStatus)
  status?: ETxStatus;

  @ApiPropertyOptional({ description: 'Page size', example: 10, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor returned by the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
