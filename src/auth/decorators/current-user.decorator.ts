import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface IAuthUser {
  userId: string;
  externalAuthId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IAuthUser =>
    ctx.switchToHttp().getRequest().user,
);
