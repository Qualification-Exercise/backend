import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import {
  ADMIN_KEY_HEADER,
  AdminKeyGuard,
} from '@/common/guards/admin-key.guard';
import { MerchantResponseDTO } from '@/payments/dtos/merchant.response.dto';
import { RegisterMerchantDTO } from '@/payments/dtos/register-merchant.dto';
import { MerchantsService } from '@/payments/services/merchants.service';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'List merchants',
    description:
      'Addresses whose incoming transfers earn cashback. Active ones only by default.',
  })
  @ApiQuery({ name: 'all', required: false, type: Boolean })
  @ApiOkResponse({ type: [MerchantResponseDTO] })
  list(
    @Query('all', new ParseBoolPipe({ optional: true })) all?: boolean,
  ): Promise<MerchantResponseDTO[]> {
    return this.merchants.list(!all);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get one merchant' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MerchantResponseDTO })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantResponseDTO> {
    return this.merchants.findById(id);
  }

  @Post()
  @UseGuards(AdminKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: ADMIN_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Register a merchant (admin)',
    description:
      'The payment poller starts watching this address on its next tick. ' +
      'Guarded by ADMIN_API_KEY, not a user token: whoever can register an ' +
      'address can earn cashback by paying it.',
  })
  @ApiOkResponse({ type: MerchantResponseDTO })
  register(@Body() dto: RegisterMerchantDTO): Promise<MerchantResponseDTO> {
    return this.merchants.register(dto);
  }
}
