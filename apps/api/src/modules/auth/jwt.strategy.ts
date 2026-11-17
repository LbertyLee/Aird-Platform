import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { AuthService } from './auth.service';
import { TokenClaims } from './token.service';

/**
 * Passport JWT 策略，填充 AuthUserContext。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * @param config 配置
   * @param authService 认证服务
   */
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * 将 JWT payload 转为请求用户上下文。
   */
  async validate(payload: TokenClaims): Promise<AuthUserContext> {
    const permissionCodes = await this.authService.resolvePermissionCodes(
      payload.roleIds ?? [],
    );
    return {
      userId: payload.sub,
      username: payload.username,
      permissionCodes,
      roleIds: payload.roleIds ?? [],
    };
  }
}
