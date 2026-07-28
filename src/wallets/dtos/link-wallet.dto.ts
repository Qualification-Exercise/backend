import { IsString, Matches, MaxLength, IsUUID } from 'class-validator';

export class LinkWalletDTO {
  @IsString()
  @MaxLength(128)
  address: string;

  @IsUUID()
  challengeId: string;

  @Matches(/^0x[0-9a-fA-F]{130}$/, {
    message: 'signature must be a 65-byte hex secp256k1 signature',
  })
  signature: string;
}
