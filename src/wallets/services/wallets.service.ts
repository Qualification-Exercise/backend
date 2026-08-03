import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type EntityManager } from 'typeorm';

import { chainKindOf } from '@/chains';
import { EChainKind } from '@/chains/chain-kind.enum';
import { apiError } from '@/common/api-error';
import {
  CHAIN_KIND_OF_FAMILY,
  InvalidAddressError,
  normalizeAddress,
} from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';
import type {
  LinkWalletEntryDTO,
  LinkWalletsDTO,
} from '@/wallets/dtos/link-wallets.dto';

export interface IWalletResponse {
  chain: EChainKind;
  srcChainId: number;
  address: string;
  primary: boolean;
  verified: boolean;
  linkedAt: string;
}

/** One request entry, once it has survived validation. */
interface IResolvedEntry {
  chain: EChainKind;
  srcChainId: number;
  address: string;
  path: string | null;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
  ) {}

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

    const stored = await this.wallets.manager.transaction((em) =>
      this.store(em, userId, entries),
    );
    return { wallets: stored.map((w) => this.toResponse(w)) };
  }

  async confirmOwnership(
    em: EntityManager,
    userId: string,
    address: string,
  ): Promise<void> {
    const existing = await em.findOne(Wallet, { where: { address } });

    if (existing && existing.userId !== userId) {
      this.logger.error(
        `security_event=wallet.address_reassigned address=${address} ` +
          `from=${existing.userId} to=${userId} reason=proved_ownership`,
      );
      await em.delete(Wallet, { id: existing.id });
    }

    await em.update(
      Wallet,
      { userId, address },
      { verified: true, verifiedAt: new Date() },
    );
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
        this.logger.warn(
          `security_event=wallet.address_already_linked address=${entry.address} ` +
            `claimedBy=${userId} heldBy=${taken.userId} verified=${taken.verified}`,
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
          verified: false,
          verifiedAt: null,
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
