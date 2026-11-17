import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { REDIS_PORT } from '../../common/constants/injection-tokens';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IRedisPort } from '../../infrastructure/redis/redis.service';

/**
 * JWT 声明。
 */
export interface TokenClaims {
  /** 用户 ID */
  sub: string;
  /** 登录名 */
  username: string;
  /** 角色 ID 列表 */
  roleIds: string[];
}

/**
 * 令牌对。
 */
export interface TokenPair {
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 过期秒数 */
  expiresIn: number;
}

/**
 * JWT 访问令牌与刷新令牌管理。
 */
@Injectable()
export class TokenService {
  /** 访问令牌 TTL（秒） */
  private readonly accessTtlSec: number;
  /** 刷新令牌 TTL（秒） */
  private readonly refreshTtlSec: number;

  /**
   * @param jwt JWT 服务
   * @param config 配置
   * @param redis Redis 端口
   */
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_PORT) private readonly redis: IRedisPort,
  ) {
    this.accessTtlSec = Number(this.config.get('JWT_ACCESS_TTL_SEC') ?? 7200);
    this.refreshTtlSec = Number(this.config.get('JWT_REFRESH_TTL_SEC') ?? 604800);
  }

  /**
   * 签发双令牌并持久化刷新令牌。
   */
  async issueAccessAndRefresh(
    userId: string,
    claims: Omit<TokenClaims, 'sub'>,
  ): Promise<TokenPair> {
    const payload: TokenClaims = { sub: userId, ...claims };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessTtlSec,
    });
    const refreshToken = randomUUID();
    await this.redis.set(
      this.refreshTokenKey(refreshToken),
      userId,
      this.refreshTtlSec,
    );
    await this.redis.set(
      this.refreshUserKey(userId, refreshToken),
      '1',
      this.refreshTtlSec,
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSec,
    };
  }

  /**
   * 根据刷新令牌解析用户 ID。
   */
  async resolveUserIdByRefresh(refreshToken: string): Promise<string> {
    const userId = await this.redis.get(this.refreshTokenKey(refreshToken));
    if (!userId) {
      throw new BusinessException('AUTH_REFRESH_INVALID', '刷新令牌无效或已过期', 401);
    }
    return userId;
  }

  /**
   * 轮换刷新令牌。
   */
  async rotateRefresh(
    refreshToken: string,
    claims: Omit<TokenClaims, 'sub'>,
  ): Promise<TokenPair> {
    const userId = await this.resolveUserIdByRefresh(refreshToken);
    await this.revokeRefresh(userId, refreshToken);
    return this.issueAccessAndRefresh(userId, claims);
  }

  /**
   * 吊销指定刷新令牌。
   */
  async revokeRefresh(userId: string, refreshToken: string): Promise<void> {
    await this.redis.del(this.refreshTokenKey(refreshToken));
    await this.redis.del(this.refreshUserKey(userId, refreshToken));
  }

  /**
   * 吊销用户全部会话（禁用/重置密码时）。
   */
  async revokeUserSessions(userId: string): Promise<void> {
    // 通过用户维度前缀清理；token 映射键在过期后自然失效
    await this.redis.delByPrefix(`auth:refresh:user:${userId}:`);
  }

  /**
   * 刷新令牌 -> userId 映射键。
   */
  private refreshTokenKey(refreshToken: string): string {
    return `auth:refresh:token:${refreshToken}`;
  }

  /**
   * 用户维度刷新令牌键。
   */
  private refreshUserKey(userId: string, refreshToken: string): string {
    return `auth:refresh:user:${userId}:${refreshToken}`;
  }
}
