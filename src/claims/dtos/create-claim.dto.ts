import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateClaimDTO {
  @ApiProperty({
    description: 'Challenge id from GET /claims/challenge',
    format: 'uuid',
  })
  @IsUUID()
  challengeId: string;

  @ApiProperty({
    description:
      "65-byte hex secp256k1 signature over the challenge's `message`",
    example: `0x${'ab'.repeat(65)}`,
  })
  @Matches(/^0x[0-9a-fA-F]{130}$/, {
    message: 'signature must be a 65-byte hex secp256k1 signature',
  })
  signature: string;

  @ApiPropertyOptional({
    description: 'Coupon to claim — send exactly one of couponId or code',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  couponId?: string;

  @ApiPropertyOptional({
    description: 'Coupon code — send exactly one of couponId or code',
    example: 'CB-8F3A21',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}
