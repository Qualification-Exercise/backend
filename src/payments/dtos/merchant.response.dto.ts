import { ApiProperty } from '@nestjs/swagger';

import type { Merchant } from '@/payments/entities/merchant.entity';

export class MerchantResponseDTO {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Demo Merchant' })
  name: string;

  @ApiProperty({ example: 11155111 })
  srcChainId: number;

  @ApiProperty({ example: '0x1234567890AbcdEF1234567890aBcdef12345678' })
  address: string;

  @ApiProperty({ example: 'usdt' })
  token: string;

  @ApiProperty({
    description: 'Cashback paid on payments to this address, in basis points',
    example: 500,
  })
  cashbackBps: number;

  @ApiProperty({ example: 100 })
  priority: number;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  static from(merchant: Merchant, cashbackBps: number): MerchantResponseDTO {
    return {
      id: merchant.id,
      name: merchant.name,
      srcChainId: Number(merchant.srcChainId),
      address: merchant.address,
      token: merchant.token,
      cashbackBps,
      priority: merchant.priority,
      active: merchant.active,
      createdAt: merchant.createdAt.toISOString(),
    };
  }
}
