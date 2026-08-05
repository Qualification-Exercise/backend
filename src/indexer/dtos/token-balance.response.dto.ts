import { ApiProperty } from '@nestjs/swagger';

export class TokenBalanceResponseDto {
  @ApiProperty({
    description: 'Blockchain name',
    example: 'ethereum',
  })
  blockchain: string;

  @ApiProperty({
    description: 'Token symbol',
    example: 'usdt',
  })
  token: string;

  @ApiProperty({
    description: 'Wallet address',
    example: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  })
  address: string;

  @ApiProperty({
    description: 'Token amount in raw units',
    example: '1000000000',
  })
  amount: string;

  @ApiProperty({
    description: 'Token decimals for client-side formatting',
    example: 6,
  })
  decimals: number;

  @ApiProperty({
    description:
      'Timestamp in seconds (Unix epoch) when balance was last updated',
    example: 1780272000,
  })
  lastUpdated: number;
}

export class TokenBalanceWrapperResponseDto {
  @ApiProperty({ type: TokenBalanceResponseDto })
  tokenBalance: TokenBalanceResponseDto;
}
