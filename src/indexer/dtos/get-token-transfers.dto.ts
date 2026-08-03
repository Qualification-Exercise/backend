import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumberString,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator';

import {
  EBlockchain,
  EAsset,
  SUPPORTED_BLOCKCHAINS,
  SUPPORTED_ASSETS,
} from '@/indexer/enums/blockchain.enum';

export class GetTokenTransfersDto {
  @ApiProperty({
    description: 'Blockchain name',
    example: 'ethereum',
    enum: SUPPORTED_BLOCKCHAINS,
  })
  @IsEnum(EBlockchain)
  blockchain: EBlockchain;

  @ApiProperty({
    description: 'Token symbol',
    example: 'usdt',
    enum: SUPPORTED_ASSETS,
  })
  @IsEnum(EAsset)
  token: EAsset;

  @ApiProperty({
    description: 'Wallet address',
    example: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  })
  @IsString()
  address: string;

  @ApiProperty({
    description: 'Maximum results to return',
    example: '10',
  })
  @IsNumberString()
  @Matches(/^\d+$/, { message: 'limit must be a positive integer' })
  limit: string;

  @ApiPropertyOptional({
    description:
      'Start timestamp in milliseconds (Unix epoch). Filters transfers on or after this time.',
    example: '1780272000000',
  })
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+$/, {
    message: 'fromTs must be a positive integer (milliseconds)',
  })
  fromTs?: string;

  @ApiPropertyOptional({
    description:
      'End timestamp in milliseconds (Unix epoch). Filters transfers up to this time.',
    example: '1780273000000',
  })
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+$/, {
    message: 'toTs must be a positive integer (milliseconds)',
  })
  toTs?: string;
}
