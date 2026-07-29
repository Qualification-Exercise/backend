import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface IAuthUser {
  userId: string;
  externalAuthId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IAuthUser => {
    console.log(ctx.switchToHttp().getRequest());
    return ctx.switchToHttp().getRequest().user;
  },
);
