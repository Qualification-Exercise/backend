import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import type { Hex } from 'viem';

import { apiError } from '@/common/api-error';
import {
  InvalidAddressError,
  UnsupportedProofError,
  normalizeAddress,
  ownershipMessage,
  verifyOwnership,
} from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { WalletChallenge } from '@/wallets/entities/wallet-challenge.entity';
import type { LinkWalletDTO } from '@/wallets/dtos/link-wallet.dto';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PG_UNIQUE_VIOLATION = '23505';

export interface IChallengeResponse {
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

export interface IWalletResponse {
  address: string;
  chainFamily: string;
  linkedAt: string;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletChallenge)
    private readonly challenges: Repository<WalletChallenge>,
  ) {}

  async createChallenge(userId: string): Promise<IChallengeResponse> {
    await this.challenges.delete({ userId, expiresAt: LessThan(new Date()) });

    const challenge = await this.challenges.save(
      this.challenges.create({
        userId,
        nonce: `0x${randomBytes(32).toString('hex')}`,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        consumedAt: null,
      }),
    );

    return {
      challengeId: challenge.id,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async listWallets(userId: string): Promise<IWalletResponse[]> {
    const rows = await this.wallets.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((w) => ({
      address: w.address,
      chainFamily: w.chainFamily,
      linkedAt: w.createdAt.toISOString(),
    }));
  }

  async linkWallet(
    userId: string,
    dto: LinkWalletDTO,
  ): Promise<{ address: string; linked: true }> {
    const { family, address } = this.normalizeOrThrow(dto.address);
    const nonce = await this.consumeChallenge(userId, dto.challengeId);

    let proven = false;
    try {
      proven = await verifyOwnership(
        address,
        ownershipMessage(nonce),
        dto.signature as Hex,
      );
    } catch (err) {
      if (err instanceof UnsupportedProofError) {
        throw new NotImplementedException(
          apiError('WALLET_PROOF_UNSUPPORTED', err.message, { family }),
        );
      }
      throw err;
    }

    if (!proven) {
      this.logger.warn(
        `security_event=wallet.ownership_proof_failed userId=${userId} address=${address}`,
      );
      throw new BadRequestException(
        apiError(
          'OWNERSHIP_PROOF_INVALID',
          'Signature does not prove control of this address',
        ),
      );
    }

    return this.store(userId, address, family);
  }

  private normalizeOrThrow(input: string) {
    try {
      return normalizeAddress(input);
    } catch (err) {
      if (err instanceof InvalidAddressError) {
        throw new BadRequestException(apiError('INVALID_ADDRESS', err.message));
      }
      throw err;
    }
  }

  private async consumeChallenge(
    userId: string,
    challengeId: string,
  ): Promise<string> {
    const claimed = await this.challenges
      .createQueryBuilder()
      .update(WalletChallenge)
      .set({ consumedAt: new Date() })
      .where('id = :challengeId', { challengeId })
      .andWhere('"userId" = :userId', { userId })
      .andWhere('"consumedAt" IS NULL')
      .andWhere('"expiresAt" > now()')
      .returning('nonce')
      .execute();

    const nonce = claimed.raw?.[0]?.nonce;
    if (!nonce) {
      throw new BadRequestException(
        apiError(
          'CHALLENGE_INVALID',
          'Challenge is unknown, already used, expired, or belongs to another user',
        ),
      );
    }
    return nonce as string;
  }

  private async store(
    userId: string,
    address: string,
    chainFamily: Wallet['chainFamily'],
  ): Promise<{ address: string; linked: true }> {
    try {
      await this.wallets.insert({ userId, address, chainFamily });
      return { address, linked: true };
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
      return this.resolveExisting(userId, address);
    }
  }

  private async resolveExisting(
    userId: string,
    address: string,
  ): Promise<{ address: string; linked: true }> {
    const existing = await this.wallets.findOne({ where: { address } });

    if (existing?.userId === userId) return { address, linked: true };

    this.logger.error(
      `security_event=wallet.address_already_linked address=${address} ` +
        `claimedBy=${userId} ownedBy=${existing?.userId ?? 'unknown'}`,
    );
    throw new ConflictException(
      apiError(
        'ADDRESS_ALREADY_LINKED',
        'Address is already mapped to another user',
      ),
    );
  }
}
