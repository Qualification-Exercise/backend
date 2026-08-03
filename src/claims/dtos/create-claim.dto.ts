import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateClaimDTO {
  @IsOptional()
  @IsUUID()
  couponId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}
