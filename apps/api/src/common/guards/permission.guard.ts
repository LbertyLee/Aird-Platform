import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUserContext } from '../types/auth-user.context';

/**
 * 校验菜单/按钮权限码。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  /**
   * @param reflector 读取 handler 元数据
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * 无权限码要求则放行；否则要求用户具备全部声明权限码。
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUserContext }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('未登录或会话无效');
    }

    const owned = new Set(user.permissionCodes ?? []);
    // 单个声明内可用 | 表示「满足其一即可」（与管理端菜单 dual-code 一致）
    const missing = required.filter((code) => {
      const alts = code.split('|').map((c) => c.trim()).filter(Boolean);
      return !alts.some((c) => owned.has(c));
    });
    if (missing.length > 0) {
      throw new ForbiddenException(`缺少权限: ${missing.join(', ')}`);
    }
    return true;
  }
}
