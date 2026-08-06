import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { Env } from '@/config/env';

export const ADMIN_KEY_HEADER = 'x-admin-key';

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get('ADMIN_API_KEY');
    const presented = context
      .switchToHttp()
      .getRequest<Request>()
      .header(ADMIN_KEY_HEADER);

    if (!expected || !presented || !equals(presented, expected)) {
      throw new UnauthorizedException(
        apiError(EErrorCodes.ADMIN_KEY_INVALID, 'Admin key missing or invalid'),
      );
    }
    return true;
  }
}
