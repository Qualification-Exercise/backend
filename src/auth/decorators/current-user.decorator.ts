import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface IAuthUser {
  userId: string;
  externalAuthId: string;
  email: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IAuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
