import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { EChainKind } from '@/chains/chain-kind.enum';
import { ETxType } from '@/transactions/enums/tx.enum';

export class TxFeeDTO {
  @IsString()
  @MaxLength(16)
  token: string;

  @Matches(/^\d{1,78}$/, { message: 'fee.amount must be an integer string' })
  amount: string;
}

export class CreateTransactionDTO {
  @IsEnum(EChainKind)
  chain: EChainKind;

  @Type(() => Number)
  @IsInt()
  srcChainId: number;

  @IsString()
  @MaxLength(128)
  txHash: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  outputIndex?: number;

  @IsOptional()
  @IsEnum(ETxType)
  type?: ETxType;

  @IsIn(['in', 'out'])
  direction: 'in' | 'out';

  @IsString()
  @MaxLength(16)
  token: string;

  // Smallest unit, as a string: a number would lose an 18-decimal amount.
  @Matches(/^\d{1,78}$/, { message: 'amount must be an integer string' })
  amount: string;

  @IsString()
  @MaxLength(128)
  from: string;

  @IsString()
  @MaxLength(128)
  to: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TxFeeDTO)
  fee?: TxFeeDTO;

  @IsOptional()
  @IsISO8601()
  broadcastAt?: string;
}
