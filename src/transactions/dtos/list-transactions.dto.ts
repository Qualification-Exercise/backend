import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

import { EChainKind } from '@/chains/chain-kind.enum';
import { ETxStatus, ETxType } from '@/transactions/enums/tx.enum';

export class ListTransactionsDTO {
  @IsOptional()
  @IsEnum(EChainKind)
  chain?: EChainKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  srcChainId?: number;

  @IsOptional()
  @IsEnum(ETxType)
  type?: ETxType;

  @IsOptional()
  @IsEnum(ETxStatus)
  status?: ETxStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
