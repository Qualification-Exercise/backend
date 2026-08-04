import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, Matches } from 'class-validator';

export class GetTokenTransfersDto {
  @ApiProperty({
    description: 'Maximum results to return',
    example: '10',
  })
  @IsNumberString()
  @Matches(/^\d+$/, { message: 'limit must be a positive integer' })
  limit: string;

  @ApiPropertyOptional({
    description:
      'Start timestamp in milliseconds (Unix epoch). Filters transfers on or after this time.',
    example: '1780272000000',
  })
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+$/, {
    message: 'fromTs must be a positive integer (milliseconds)',
  })
  fromTs?: string;

  @ApiPropertyOptional({
    description:
      'End timestamp in milliseconds (Unix epoch). Filters transfers up to this time.',
    example: '1780273000000',
  })
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+$/, {
    message: 'toTs must be a positive integer (milliseconds)',
  })
  toTs?: string;
}
