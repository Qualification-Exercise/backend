import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterMerchantDTO {
  @ApiProperty({ description: 'Display name', example: 'Demo Merchant' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    description: 'Chain the merchant is paid on',
    example: 11155111,
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  srcChainId: number;

  @ApiProperty({
    description: 'Address that receives payments',
    example: '0x1234567890AbcdEF1234567890aBcdef12345678',
  })
  @IsString()
  address: string;

  @ApiProperty({
    description: 'Token symbol the indexer serves',
    example: 'usdt',
  })
  @IsString()
  token: string;

  @ApiPropertyOptional({
    description: 'Poll order, lower runs first',
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ description: 'Poll this merchant', example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
