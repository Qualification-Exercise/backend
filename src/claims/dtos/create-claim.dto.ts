import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateClaimDTO {
  @IsUUID()
  challengeId: string;

  @Matches(/^0x[0-9a-fA-F]{130}$/, {
    message: 'signature must be a 65-byte hex secp256k1 signature',
  })
  signature: string;

  @IsOptional()
  @IsUUID()
  couponId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}
