import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
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

  @IsOptional()
  @Matches(/^0x[0-9a-fA-F]{130}$/, {
    message: 'signature must be a 65-byte hex secp256k1 signature',
  })
  signature?: string;
}

export class LinkWalletsDTO {
  @IsUUID()
  challengeId: string;

  @ValidateNested({ each: true })
  @Type(() => LinkWalletEntryDTO)
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  wallets: LinkWalletEntryDTO[];
}
