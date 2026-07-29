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
  @IsOptional()
  @IsIn(COUPON_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
