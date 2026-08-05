import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: 'Fee token symbol', example: 'ETH' })
  @IsString()
  @MaxLength(16)
  token: string;

  @ApiProperty({
    description: 'Fee in the token smallest unit, integer string',
    example: '210000000000000',
  })
  @Matches(/^\d{1,78}$/, { message: 'fee.amount must be an integer string' })
  amount: string;
}

export class CreateTransactionDTO {
  @ApiProperty({ enum: EChainKind, description: 'Chain family' })
  @IsEnum(EChainKind)
  chain: EChainKind;

  @ApiProperty({
    description: 'Source chain id (EVM chain id, or the synthetic id for UTXO)',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  srcChainId: number;

  @ApiProperty({
    description: 'Broadcast transaction hash',
    example: '0x5c9f...e1',
  })
  @IsString()
  @MaxLength(128)
  txHash: string;

  @ApiPropertyOptional({
    description: 'UTXO output index; omit on account-based chains',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  outputIndex?: number;

  @ApiPropertyOptional({ enum: ETxType })
  @IsOptional()
  @IsEnum(ETxType)
  type?: ETxType;

  @ApiProperty({ enum: ['in', 'out'], description: 'Relative to the user' })
  @IsIn(['in', 'out'])
  direction: 'in' | 'out';

  @ApiProperty({ description: 'Token symbol', example: 'USDT' })
  @IsString()
  @MaxLength(16)
  token: string;

  // Smallest unit, as a string: a number would lose an 18-decimal amount.
  @ApiProperty({
    description: 'Amount in the token smallest unit, integer string',
    example: '1000000',
  })
  @Matches(/^\d{1,78}$/, { message: 'amount must be an integer string' })
  amount: string;

  @ApiProperty({ description: 'Sender address' })
  @IsString()
  @MaxLength(128)
  from: string;

  @ApiProperty({ description: 'Recipient address' })
  @IsString()
  @MaxLength(128)
  to: string;

  @ApiPropertyOptional({ type: TxFeeDTO })
  @IsOptional()
  @ValidateNested()
  @Type(() => TxFeeDTO)
  fee?: TxFeeDTO;

  @ApiPropertyOptional({
    description: 'ISO-8601 broadcast time',
    example: '2026-08-05T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  broadcastAt?: string;
}
