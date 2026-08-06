import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { chainKindOf, indexerPath } from '@/chains';
import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { Env } from '@/config/env';
import { MerchantResponseDTO } from '@/payments/dtos/merchant.response.dto';
import type { RegisterMerchantDTO } from '@/payments/dtos/register-merchant.dto';
import { Merchant } from '@/payments/entities/merchant.entity';
import { CHAIN_KIND_OF_FAMILY, normalizeAddress } from '@/wallets/address';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);
  private readonly cashbackBps: number;

  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    configService: ConfigService<Env, true>,
  ) {
    this.cashbackBps = configService.get('CASHBACK_BPS');
  }

  async list(activeOnly: boolean): Promise<MerchantResponseDTO[]> {
    const merchants = await this.merchants.find({
      where: activeOnly ? { active: true } : {},
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
    return merchants.map((m) => MerchantResponseDTO.from(m, this.cashbackBps));
  }

  async findById(id: string): Promise<MerchantResponseDTO> {
    const merchant = await this.merchants.findOne({ where: { id } });
    if (!merchant) {
      throw new NotFoundException(
        apiError(EErrorCodes.MERCHANT_NOT_FOUND, `No merchant with id ${id}`),
      );
    }
    return MerchantResponseDTO.from(merchant, this.cashbackBps);
  }

  async register(dto: RegisterMerchantDTO): Promise<MerchantResponseDTO> {
    const address = this.canonicalFor(dto.srcChainId, dto.address);
    const token = dto.token.trim().toLowerCase();

    try {
      indexerPath(dto.srcChainId, token);
    } catch (err) {
      throw new BadRequestException(
        apiError(EErrorCodes.INVALID_REQUEST, (err as Error).message),
      );
    }

    const merchant = this.merchants.create({
      name: dto.name.trim(),
      srcChainId: dto.srcChainId,
      address,
      token,
      priority: dto.priority ?? 100,
      active: dto.active ?? true,
    });

    try {
      await this.merchants.insert(merchant);
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
      throw new ConflictException(
        apiError(
          EErrorCodes.MERCHANT_ALREADY_REGISTERED,
          `${address} is already registered on chain ${dto.srcChainId}`,
        ),
      );
    }

    this.logger.log(
      `Merchant registered: ${merchant.name} ${address} ` +
        `chain=${dto.srcChainId} token=${token}`,
    );
    return MerchantResponseDTO.from(merchant, this.cashbackBps);
  }

  private canonicalFor(srcChainId: number, input: string): string {
    let kind: ReturnType<typeof chainKindOf>;
    try {
      kind = chainKindOf(srcChainId);
    } catch (err) {
      throw new BadRequestException(
        apiError(EErrorCodes.UNSUPPORTED_CHAIN, (err as Error).message),
      );
    }

    let normalized: ReturnType<typeof normalizeAddress>;
    try {
      normalized = normalizeAddress(input);
    } catch (err) {
      throw new BadRequestException(
        apiError(EErrorCodes.INVALID_MERCHANT_ADDRESS, (err as Error).message),
      );
    }

    if (CHAIN_KIND_OF_FAMILY[normalized.family] !== kind) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.INVALID_MERCHANT_ADDRESS,
          `${normalized.family} address does not belong to chain ${srcChainId}`,
        ),
      );
    }
    return normalized.address;
  }
}
