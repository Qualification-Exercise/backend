import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const MAX_LIVE_PRICING_SOURCES = 10;

export class GetLivePricingDto {
  @ApiProperty({
    description: `Comma-separated source assets, at most ${MAX_LIVE_PRICING_SOURCES}`,
    example: 'BTC,ETH',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(
    new RegExp(
      `^[A-Za-z0-9]{1,16}(,[A-Za-z0-9]{1,16}){0,${MAX_LIVE_PRICING_SOURCES - 1}}$`,
    ),
    {
      message: `fromSources must be 1-${MAX_LIVE_PRICING_SOURCES} comma-separated tickers`,
    },
  )
  fromSources: string;

  @ApiPropertyOptional({
    description: 'Target currency (default: USD)',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,16}$/)
  to?: string;
}
