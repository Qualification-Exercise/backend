import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CreateClaimDTO } from '@/claims/dtos/create-claim.dto';
import { ListClaimsDTO } from '@/claims/dtos/list-claims.dto';
import { ClaimsService } from '@/claims/services/claims.service';

@ApiTags('claims')
@ApiBearerAuth('jwt')
@Controller('claims')
@UseGuards(JwtAuthGuard)
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a claim',
    description:
      'Answers a challenge from `GET /claims/challenge` with a secp256k1 signature over its message. Accepted for asynchronous relaying — poll `GET /claims/{id}` for the on-chain result.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Repeat with the same key to get the first result back',
  })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: 'Claim queued' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Coupon already claimed or claim in flight',
  })
  create(
    @CurrentUser() user: IAuthUser,
    @Body() dto: CreateClaimDTO,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.claimsService.create(user.userId, dto, idempotencyKey);
  }

  @Get()
  @ApiOperation({
    summary: 'List my claims',
    description: 'Cursor-paginated, newest first.',
  })
  list(@CurrentUser() user: IAuthUser, @Query() query: ListClaimsDTO) {
    return this.claimsService.list(user.userId, query);
  }

  // Declared before `:id` so "preview" is a route, not a claim id.
  @Get('preview')
  @ApiOperation({
    summary: 'Preview what is claimable now',
    description:
      'Currently issued, unexpired coupons, their total UTL, and when the next claim becomes allowed.',
  })
  preview(@CurrentUser() user: IAuthUser) {
    return this.claimsService.preview(user.userId);
  }

  @Get('challenge')
  @ApiOperation({
    summary: 'Get a claim challenge to sign',
    description:
      'Returns `challengeId`, `nonce`, the exact `message` to sign with the wallet key, `expiresAt`, and the ERC-1271 signing domain (`verifyingContract`, `chainId`). An EOA signs `message` with personal_sign; a smart account (Safe) signs the EIP-712 `SafeMessage { bytes message }` over domain `{ chainId, verifyingContract }` where `message` is `keccak256(EIP-191 hash of the message)` as Safe defines it. Post the signature to `POST /claims`.',
  })
  @ApiQuery({
    name: 'coupon',
    required: false,
    description: 'Coupon code the challenge is bound to',
  })
  @ApiOkResponse({ description: 'Challenge to be signed before it expires' })
  challenge(@CurrentUser() user: IAuthUser, @Query('coupon') coupon: string) {
    return this.claimsService.createChallenge(user.userId, coupon ?? '');
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my claims',
    description: 'Includes attestation count and settlement status.',
  })
  @ApiParam({ name: 'id', description: 'Claim UUID', format: 'uuid' })
  findById(@CurrentUser() user: IAuthUser, @Param('id') id: string) {
    return this.claimsService.findById(user.userId, id);
  }
}
