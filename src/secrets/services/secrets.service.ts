import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EChainKind } from '@/chains/chain-kind.enum';
import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { PutSecretDTO } from '@/secrets/dtos/put-secret.dto';
import { SECRET_MAX_LENGTHS, SECRETS_KDF_FLOOR } from '@/secrets/kdf-floor';
import { InvalidAddressError, normalizeAddress } from '@/wallets/address';
import { WalletSecret } from '@/wallets/entities/wallet-secret.entity';
import { Wallet } from '@/wallets/entities/wallet.entity';

export type SecretKind = 'entropy' | 'seed';

export interface IStoredSecretResponse {
  stored: SecretKind;
  wordCount: number;
  updatedAt: string;
}

export interface ISecretResponse {
  entropy?: string;
  seed?: string;
  wrappedKey: {
    ciphertext: string;
    kdf: Record<string, unknown>;
    cipher: string;
    version: number;
  };
  metadata: { address: string; wordCount: number };
  updatedAt: string;
}

/**
 * Ciphertext in, ciphertext out. The mnemonic, the entropy, the seed, the
 * passphrase and the encryption key never reach this process — encryption and
 * decryption happen on the device, and the only thing stored here that depends
 * on the passphrase is the wrapped key.
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    @InjectRepository(WalletSecret)
    private readonly secrets: Repository<WalletSecret>,
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
  ) {}

  async put(
    userId: string,
    kind: SecretKind,
    dto: PutSecretDTO,
  ): Promise<IStoredSecretResponse> {
    const blob = dto[kind];
    if (!blob) {
      throw new BadRequestException(
        apiError(EErrorCodes.INVALID_REQUEST, `Body must carry "${kind}"`),
      );
    }
    this.assertSize(kind, blob);

    const primaryAddress = await this.assertPrimaryAddress(
      userId,
      dto.metadata.address,
    );

    const existing = await this.secrets.findOne({ where: { userId } });
    if (!existing && !dto.wrappedKey) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.INVALID_REQUEST,
          'wrappedKey is required on the first write',
        ),
      );
    }
    if (dto.wrappedKey) {
      this.assertKdfFloor(dto.wrappedKey.kdf);
      this.assertSize('wrappedKey', dto.wrappedKey.ciphertext);
    }

    const now = new Date();
    const row =
      existing ??
      this.secrets.create({
        userId,
        encryptedEntropy: null,
        encryptedSeed: null,
      });

    if (kind === 'entropy') {
      row.encryptedEntropy = blob;
      row.entropyUpdatedAt = now;
    } else {
      row.encryptedSeed = blob;
      row.seedUpdatedAt = now;
    }

    // Omitted wrappedKey keeps the stored one; sending one is a passphrase
    // change, and it re-wraps both blobs at once because they share the key.
    if (dto.wrappedKey) {
      row.wrappedKey = dto.wrappedKey.ciphertext;
      row.kdf = { ...dto.wrappedKey.kdf };
      row.cipher = dto.wrappedKey.cipher ?? 'aes-256-gcm';
      row.version = dto.wrappedKey.version ?? 1;
    }
    row.wordCount = dto.metadata.wordCount;
    row.primaryAddress = primaryAddress;

    const saved = await this.secrets.save(row);
    this.logger.log(
      `security_event=secrets.write userId=${userId} blob=${kind} ` +
        `rewrapped=${Boolean(dto.wrappedKey)}`,
    );

    return {
      stored: kind,
      wordCount: saved.wordCount,
      updatedAt: (kind === 'entropy'
        ? saved.entropyUpdatedAt!
        : saved.seedUpdatedAt!
      ).toISOString(),
    };
  }

  async get(userId: string, kind: SecretKind): Promise<ISecretResponse> {
    const row = await this.secrets.findOne({ where: { userId } });
    const blob = row
      ? kind === 'entropy'
        ? row.encryptedEntropy
        : row.encryptedSeed
      : null;

    // Access-logged whether or not it hit: a spike of misses is the shape of
    // an enumeration run, and it is invisible if only hits are recorded.
    this.logger.log(
      `security_event=secrets.read userId=${userId} blob=${kind} ` +
        `found=${Boolean(blob)}`,
    );

    if (!row || !blob) {
      throw new NotFoundException(
        apiError(
          EErrorCodes.SECRET_NOT_FOUND,
          `No encrypted ${kind} stored for this user`,
        ),
      );
    }

    const updatedAt =
      (kind === 'entropy' ? row.entropyUpdatedAt : row.seedUpdatedAt) ??
      row.updatedAt;

    return {
      [kind]: blob,
      wrappedKey: {
        ciphertext: row.wrappedKey,
        kdf: row.kdf,
        cipher: row.cipher,
        version: row.version,
      },
      metadata: { address: row.primaryAddress, wordCount: row.wordCount },
      updatedAt: updatedAt.toISOString(),
    } as ISecretResponse;
  }

  /** Idempotent, and a hard delete: a soft-deleted seed backup is a backup. */
  async remove(userId: string): Promise<void> {
    const result = await this.secrets.delete({ userId });
    this.logger.log(
      `security_event=secrets.deleted userId=${userId} rows=${result.affected ?? 0}`,
    );
  }

  /** Drives onboarding resume in `GET /users/me`. */
  async status(userId: string) {
    const row = await this.secrets.findOne({ where: { userId } });
    return {
      entropy: Boolean(row?.encryptedEntropy),
      seed: Boolean(row?.encryptedSeed),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  private assertSize(
    kind: keyof typeof SECRET_MAX_LENGTHS,
    value: string,
  ): void {
    if (value.length <= SECRET_MAX_LENGTHS[kind]) return;
    throw new BadRequestException(
      apiError(
        EErrorCodes.INVALID_BLOB_SIZE,
        `${kind} must be at most ${SECRET_MAX_LENGTHS[kind]} base64 characters`,
      ),
    );
  }

  private assertKdfFloor(kdf: {
    algo: string;
    m: number;
    t: number;
    p: number;
  }) {
    const weak =
      kdf.algo !== SECRETS_KDF_FLOOR.algo ||
      kdf.m < SECRETS_KDF_FLOOR.m ||
      kdf.t < SECRETS_KDF_FLOOR.t ||
      kdf.p < SECRETS_KDF_FLOOR.p;
    if (!weak) return;

    throw new BadRequestException(
      apiError(
        EErrorCodes.WEAK_KDF_PARAMS,
        'Wrapped key was derived below the KDF floor published by GET /config',
        { floor: SECRETS_KDF_FLOOR },
      ),
    );
  }

  /**
   * The blob is attributed to the primary EVM wallet, so a blob whose declared
   * address is not that wallet is rejected rather than stored under a name
   * nobody can resolve later.
   */
  private async assertPrimaryAddress(
    userId: string,
    declared: string,
  ): Promise<string> {
    const wallet = await this.wallets.findOne({
      where: { userId, chain: EChainKind.EVM, isPrimary: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        apiError(
          EErrorCodes.WALLET_NOT_LINKED,
          'Link an EVM wallet before storing a backup',
        ),
      );
    }

    let normalized: string;
    try {
      normalized = normalizeAddress(declared).address;
    } catch (err) {
      if (!(err instanceof InvalidAddressError)) throw err;
      normalized = '';
    }

    if (normalized !== wallet.address) {
      throw new ConflictException(
        apiError(
          EErrorCodes.WALLET_ADDRESS_MISMATCH,
          'metadata.address is not the primary wallet of this user',
        ),
      );
    }
    return wallet.address;
  }
}
