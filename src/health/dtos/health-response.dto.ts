import { ApiProperty } from '@nestjs/swagger';

class IndexerHealthDTO {
  @ApiProperty({ example: 'CLOSED', description: 'Circuit-breaker state' })
  breaker: string;
}

export class HealthResponseDTO {
  @ApiProperty({ example: 'ok', enum: ['ok', 'error'] })
  status: string;

  @ApiProperty({ example: 'connected', enum: ['connected', 'disconnected'] })
  database: string;

  @ApiProperty({ type: IndexerHealthDTO })
  indexer: IndexerHealthDTO;

  @ApiProperty({ example: '2026-08-05T10:00:00.000Z' })
  timestamp: string;
}
