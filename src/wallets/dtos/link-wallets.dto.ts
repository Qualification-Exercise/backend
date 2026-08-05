import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { EChainKind } from '@/chains/chain-kind.enum';

export class LinkWalletEntryDTO {
  @ApiProperty({ enum: EChainKind, description: 'Chain family' })
  @IsEnum(EChainKind)
  chain: EChainKind;

  @ApiProperty({
    description: 'Source chain id; must belong to `chain`',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  srcChainId: number;

  @ApiProperty({
    description: 'Address derived on the client',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsString()
  @MaxLength(128)
  address: string;

  @ApiPropertyOptional({
    description: 'Derivation path, for the client to resume from',
    example: "m/44'/60'/0'/0/0",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  path?: string;
}

export class LinkWalletsDTO {
  @ApiProperty({
    type: [LinkWalletEntryDTO],
    description: 'One entry per chain, 1-8 entries; an EVM entry is required',
  })
  @ValidateNested({ each: true })
  @Type(() => LinkWalletEntryDTO)
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  wallets: LinkWalletEntryDTO[];
}
