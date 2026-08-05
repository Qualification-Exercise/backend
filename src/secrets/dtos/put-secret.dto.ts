import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBase64,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class KdfDTO {
  @ApiProperty({ enum: ['argon2id'], example: 'argon2id' })
  @IsIn(['argon2id'])
  algo: string;

  @ApiProperty({ description: 'Base64 salt', example: 'c2FsdHNhbHRzYWx0' })
  @IsBase64()
  @MaxLength(128)
  salt: string;

  // Memory in KiB, iterations, parallelism. The floor is enforced in the
  // service against GET /config, not here: the shape is a request concern,
  // the floor is a security control that has to move with the config.
  @ApiProperty({ description: 'Memory cost in KiB', example: 65536 })
  @IsInt()
  @Min(1)
  m: number;

  @ApiProperty({ description: 'Iterations', example: 3 })
  @IsInt()
  @Min(1)
  t: number;

  @ApiProperty({ description: 'Parallelism', example: 1 })
  @IsInt()
  @Min(1)
  p: number;
}

export class WrappedKeyDTO {
  @ApiProperty({
    description: 'Base64 ciphertext of the passphrase-wrapped data key',
  })
  @IsBase64()
  @MaxLength(256)
  ciphertext: string;

  @ApiProperty({
    type: KdfDTO,
    description: 'Must meet the floor from GET /config',
  })
  @ValidateNested()
  @Type(() => KdfDTO)
  kdf: KdfDTO;

  @ApiPropertyOptional({ enum: ['aes-256-gcm'], example: 'aes-256-gcm' })
  @IsOptional()
  @IsIn(['aes-256-gcm'])
  cipher?: string;

  @ApiPropertyOptional({ description: 'Blob format version', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class SecretMetadataDTO {
  @ApiProperty({
    description: 'Primary (EVM) wallet address this backup belongs to',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsString()
  @MaxLength(128)
  address: string;

  @ApiProperty({ enum: [12, 24], description: 'Mnemonic word count' })
  @IsIn([12, 24])
  wordCount: number;
}

/**
 * One shape for both blobs: the route decides which field is required, so a
 * body carrying `seed` cannot be stored as entropy by pointing it at the other
 * path.
 */
export class PutSecretDTO {
  @ApiPropertyOptional({
    description: 'Base64 ciphertext; required on PUT /secrets/entropy',
    maxLength: 128,
  })
  @IsOptional()
  @IsBase64()
  @MaxLength(128)
  entropy?: string;

  @ApiPropertyOptional({
    description: 'Base64 ciphertext; required on PUT /secrets/seed',
    maxLength: 192,
  })
  @IsOptional()
  @IsBase64()
  @MaxLength(192)
  seed?: string;

  @ApiPropertyOptional({ type: WrappedKeyDTO })
  @IsOptional()
  @ValidateNested()
  @Type(() => WrappedKeyDTO)
  wrappedKey?: WrappedKeyDTO;

  @ApiProperty({ type: SecretMetadataDTO })
  @ValidateNested()
  @Type(() => SecretMetadataDTO)
  metadata: SecretMetadataDTO;
}
