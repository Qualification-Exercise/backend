import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const COUPON_STATUSES = [
  'PENDING',
  'ISSUED',
  'PENDING_ATTESTATION',
  'ATTESTED',
  'CLAIM_SUBMITTED',
  'CLAIMED',
  'EXPIRED',
  'ORPHANED',
] as const;

export class ListCouponsDTO {
  @ApiPropertyOptional({
    description: 'Filter by coupon status',
    enum: COUPON_STATUSES as unknown as string[],
  })
  @IsOptional()
  @IsIn(COUPON_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({
    description: 'Page size (1-100)',
    minimum: 1,
    maximum: 100,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor returned by the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
