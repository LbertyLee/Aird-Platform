import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/**
 * 密码哈希策略端口（Strategy）。
 * 使用抽象类以便 Nest emitDecoratorMetadata 可反射类型。
 */
export abstract class IPasswordHasher {
  /**
   * 对明文密码做单向哈希。
   */
  abstract hash(plain: string): Promise<string>;

  /**
   * 校验明文与哈希是否匹配。
   */
  abstract verify(plain: string, hash: string): Promise<boolean>;
}

/**
 * bcrypt 密码哈希实现。
 */
@Injectable()
export class BcryptPasswordHasher implements IPasswordHasher {
  /** 成本因子 */
  private readonly rounds = 10;

  /**
   * 生成哈希。
   */
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  /**
   * 验密。
   */
  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
