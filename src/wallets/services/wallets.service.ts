import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository, type EntityManager } from 'typeorm';
import type { Hex } from 'viem';

import { chainKindOf } from '@/chains';
import { EChainKind } from '@/chains/chain-kind.enum';
import { apiError } from '@/common/api-error';
import {
  CHAIN_KIND_OF_FAMILY,
  FAMILY_OF_CHAIN_KIND,
  InvalidAddressError,
  normalizeAddress,
  ownershipMessage,
  proofSupported,
  verifyOwnership,
} from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { WalletChallenge } from '@/wallets/entities/wallet-challenge.entity';
import type {
  LinkWalletEntryDTO,
  LinkWalletsDTO,
} from '@/wallets/dtos/link-wallets.dto';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface IChallengeResponse {
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

export interface IWalletResponse {
  chain: EChainKind;
  srcChainId: number;
  address: string;
  primary: boolean;
  verified: boolean;
  linkedAt: string;
}

interface IResolvedEntry {
  chain: EChainKind;
  srcChainId: number;
  address: string;
  path: string | null;
  verified: boolean;
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
    return rows.map((w) => this.toResponse(w));
  }

  async linkWallets(
    userId: string,
    dto: LinkWalletsDTO,
  ): Promise<{ wallets: IWalletResponse[] }> {
    const entries = dto.wallets.map((entry) => this.resolveEntry(entry));
    this.assertOneAddressPerChain(entries);
    this.assertHasPrimary(entries);

    const nonce = await this.consumeChallenge(userId, dto.challengeId);
    const message = ownershipMessage(nonce);

    for (let i = 0; i < entries.length; i++) {
      entries[i].verified = await this.proveOwnership(
        userId,
        entries[i],
        dto.wallets[i].signature,
        message,
      );
    }

    const stored = await this.wallets.manager.transaction((em) =>
      this.store(em, userId, entries),
    );
    return { wallets: stored.map((w) => this.toResponse(w)) };
  }

  private resolveEntry(entry: LinkWalletEntryDTO): IResolvedEntry {
    const chain = this.chainOfOrThrow(entry.srcChainId);
    if (chain !== entry.chain) {
      throw new BadRequestException(
        apiError(
          'CHAIN_MISMATCH',
          `srcChainId ${entry.srcChainId} is a ${chain} chain, not ${entry.chain}`,
        ),
      );
    }

    const { family, address } = this.normalizeOrThrow(entry.address);
    if (CHAIN_KIND_OF_FAMILY[family] !== chain) {
      throw new BadRequestException(
        apiError(
          'CHAIN_MISMATCH',
          `Address ${entry.address} is not a ${chain} address`,
        ),
      );
    }

    return {
      chain,
      srcChainId: entry.srcChainId,
      address,
      path: entry.path ?? null,
      verified: false,
    };
  }

  private chainOfOrThrow(srcChainId: number): EChainKind {
    try {
      return chainKindOf(srcChainId);
    } catch {
      throw new BadRequestException(
        apiError('UNKNOWN_CHAIN', `Unsupported srcChainId: ${srcChainId}`),
      );
    }
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

  private assertOneAddressPerChain(entries: IResolvedEntry[]): void {
    const chains = new Set(entries.map((e) => e.chain));
    if (chains.size !== entries.length) {
      throw new BadRequestException(
        apiError(
          'DUPLICATE_CHAIN',
          'A user has at most one address per chain; the request lists a chain twice',
        ),
      );
    }
  }

  private assertHasPrimary(entries: IResolvedEntry[]): void {
    if (!entries.some((e) => e.chain === EChainKind.EVM)) {
      throw new BadRequestException(
        apiError(
          'NO_PRIMARY_WALLET',
          'The EVM address is the payout recipient and must be registered',
        ),
      );
    }
  }

  private async proveOwnership(
    userId: string,
    entry: IResolvedEntry,
    signature: string | undefined,
    message: string,
  ): Promise<boolean> {
    if (!proofSupported(FAMILY_OF_CHAIN_KIND[entry.chain])) {
      this.logger.log(
        `Storing ${entry.chain} address unverified: no message signing available`,
      );
      return false;
    }

    if (!signature) {
      throw new BadRequestException(
        apiError(
          'SIGNATURE_REQUIRED',
          `A ${entry.chain} address must be proven with a signature`,
          { chain: entry.chain },
        ),
      );
    }

    const proven = await verifyOwnership(
      entry.address,
      message,
      signature as Hex,
    );
    if (!proven) {
      this.logger.warn(
        `security_event=wallet.ownership_proof_failed userId=${userId} address=${entry.address}`,
      );
      throw new BadRequestException(
        apiError(
          'OWNERSHIP_PROOF_INVALID',
          'Signature does not prove control of this address',
        ),
      );
    }
    return true;
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
    em: EntityManager,
    userId: string,
    entries: IResolvedEntry[],
  ): Promise<Wallet[]> {
    const mine = await em.find(Wallet, { where: { userId } });
    const claimedElsewhere = await em.find(Wallet, {
      where: { address: In(entries.map((e) => e.address)) },
    });

    const fresh: Wallet[] = [];
    for (const entry of entries) {
      const taken = claimedElsewhere.find(
        (w) => w.address === entry.address && w.chain === entry.chain,
      );
      if (taken && taken.userId !== userId) {
        this.logger.error(
          `security_event=wallet.address_already_linked address=${entry.address} ` +
            `claimedBy=${userId} ownedBy=${taken.userId}`,
        );
        throw new ConflictException(
          apiError(
            'ADDRESS_ALREADY_LINKED',
            'Address is already mapped to another user',
          ),
        );
      }

      const existing = mine.find((w) => w.chain === entry.chain);
      if (existing) {
        // A different address for a chain the user already registered means a
        // new mnemonic, and that must be an explicit reset — never a silent
        // overwrite of the address that owns the coupons.
        if (existing.address !== entry.address) {
          throw new ConflictException(
            apiError(
              'WALLET_CHAIN_CONFLICT',
              `A different ${entry.chain} address is already registered for this user`,
              { chain: entry.chain },
            ),
          );
        }
        continue;
      }

      fresh.push(
        em.create(Wallet, {
          userId,
          chain: entry.chain,
          srcChainId: entry.srcChainId,
          address: entry.address,
          path: entry.path,
          isPrimary: entry.chain === EChainKind.EVM,
          verified: entry.verified,
          verifiedAt: entry.verified ? new Date() : null,
        }),
      );
    }

    if (fresh.length > 0) await em.save(fresh);
    return em.find(Wallet, { where: { userId }, order: { createdAt: 'ASC' } });
  }

  private toResponse(wallet: Wallet): IWalletResponse {
    return {
      chain: wallet.chain,
      srcChainId: Number(wallet.srcChainId),
      address: wallet.address,
      primary: wallet.isPrimary,
      verified: wallet.verified,
      linkedAt: wallet.createdAt.toISOString(),
    };
  }
}
