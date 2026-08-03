import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetLivePricingDto {
  @ApiProperty({
    description: 'Comma-separated list of source assets to get prices for',
    example: 'BTC,ETH',
  })
  @IsString()
  fromSources: string;

  @ApiPropertyOptional({
    description: 'Target currency (default: USD)',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  to?: string;
}
