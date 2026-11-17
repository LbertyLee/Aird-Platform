import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUserContext } from '../types/auth-user.context';

/**
 * 注入当前登录用户上下文；公开接口未登录时为 undefined。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserContext | undefined => {
    const request = ctx.switchToHttp().getRequest<{
      user?: AuthUserContext | null;
    }>();
    return request.user ?? undefined;
  },
);
