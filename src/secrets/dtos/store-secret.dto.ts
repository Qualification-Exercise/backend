import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class StoreSecretDTO {
  @ApiPropertyOptional({
    description: 'Client-side ciphertext; required on POST /entropy',
  })
  @IsOptional()
  @IsString()
  entropy?: string;

  @ApiPropertyOptional({
    description: 'Client-side ciphertext; required on POST /seed',
  })
  @IsOptional()
  @IsString()
  seed?: string;

  @ApiPropertyOptional({
    description: 'Free-form client metadata (KDF params, salt, IV, label)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
