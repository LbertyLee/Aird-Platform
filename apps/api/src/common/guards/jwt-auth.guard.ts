import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JWT 鉴权守卫；标记 @Public 的接口跳过强制登录。
 * 公开接口若携带 Bearer Token，仍会尝试解析用户（失败不拦截）。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * @param reflector 读取 handler 元数据
   */
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * 公开接口直接放行；带 Token 时尽量填充 request.user。
   */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic) {
      return super.canActivate(context);
    }

    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
    }>();
    const auth = request.headers?.authorization;
    if (typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth)) {
      return super.canActivate(context);
    }
    return true;
  }

  /**
   * 公开接口解析失败时不抛错，仅视为匿名。
   */
  handleRequest<TUser>(
    err: Error | null,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return (err || !user ? null : user) as TUser;
    }
    return super.handleRequest(err, user, info, context);
  }
}
