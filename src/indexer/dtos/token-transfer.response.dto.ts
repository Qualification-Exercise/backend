import { ApiProperty } from '@nestjs/swagger';

export class TokenTransferResponseDto {
  @ApiProperty({
    description: 'Blockchain name',
    example: 'ethereum',
  })
  blockchain: string;

  @ApiProperty({
    description: 'Block number',
    example: 12345678,
  })
  blockNumber: number;

  @ApiProperty({
    description: 'Transaction hash',
    example: '0xabc123...',
  })
  transactionHash: string;

  @ApiProperty({
    description: 'Index of transfer in transaction',
    example: 0,
  })
  transferIndex: number;

  @ApiProperty({
    description: 'Token address',
    example: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  })
  token: string;

  @ApiProperty({
    description: 'Transfer amount (raw)',
    example: '1000000',
  })
  amount: string;

  @ApiProperty({
    description: 'Timestamp in milliseconds',
    example: 1780272000000,
  })
  timestamp: number;

  @ApiProperty({
    description: 'Transaction index in block',
    example: 42,
  })
  transactionIndex: number;

  @ApiProperty({
    description: 'Log index in transaction',
    example: 5,
    nullable: true,
  })
  logIndex: number | null;

  @ApiProperty({
    description: 'From address',
    example: '0x1234567890123456789012345678901234567890',
  })
  from: string;

  @ApiProperty({
    description: 'To address',
    example: '0x0987654321098765432109876543210987654321',
  })
  to: string;

  @ApiProperty({
    description: 'Optional label',
    example: 'contract_name',
    required: false,
  })
  label?: string;

  @ApiProperty({
    description: 'Additional metadata',
    example: null,
    required: false,
  })
  metadata?: unknown | null;
}
