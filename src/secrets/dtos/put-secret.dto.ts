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
  @IsIn(['argon2id'])
  algo: string;

  @IsBase64()
  @MaxLength(128)
  salt: string;

  // Memory in KiB, iterations, parallelism. The floor is enforced in the
  // service against GET /config, not here: the shape is a request concern,
  // the floor is a security control that has to move with the config.
  @IsInt()
  @Min(1)
  m: number;

  @IsInt()
  @Min(1)
  t: number;

  @IsInt()
  @Min(1)
  p: number;
}

export class WrappedKeyDTO {
  @IsBase64()
  @MaxLength(256)
  ciphertext: string;

  @ValidateNested()
  @Type(() => KdfDTO)
  kdf: KdfDTO;

  @IsOptional()
  @IsIn(['aes-256-gcm'])
  cipher?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class SecretMetadataDTO {
  @IsString()
  @MaxLength(128)
  address: string;

  @IsIn([12, 24])
  wordCount: number;
}

/**
 * One shape for both blobs: the route decides which field is required, so a
 * body carrying `seed` cannot be stored as entropy by pointing it at the other
 * path.
 */
export class PutSecretDTO {
  @IsOptional()
  @IsBase64()
  @MaxLength(128)
  entropy?: string;

  @IsOptional()
  @IsBase64()
  @MaxLength(192)
  seed?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WrappedKeyDTO)
  wrappedKey?: WrappedKeyDTO;

  @ValidateNested()
  @Type(() => SecretMetadataDTO)
  metadata: SecretMetadataDTO;
}
