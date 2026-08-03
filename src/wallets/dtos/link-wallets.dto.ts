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
  @IsEnum(EChainKind)
  chain: EChainKind;

  @IsInt()
  @IsPositive()
  srcChainId: number;

  @IsString()
  @MaxLength(128)
  address: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  path?: string;
}

export class LinkWalletsDTO {
  @ValidateNested({ each: true })
  @Type(() => LinkWalletEntryDTO)
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  wallets: LinkWalletEntryDTO[];
}
