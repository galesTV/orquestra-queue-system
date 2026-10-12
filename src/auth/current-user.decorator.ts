import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthenticatedUser = {
  sub: string;
  establishmentId: string;
  exp: number;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest().user,
);
