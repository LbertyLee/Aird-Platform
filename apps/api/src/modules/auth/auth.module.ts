import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PASSWORD_HASHER } from '../../common/constants/injection-tokens';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BcryptPasswordHasher } from '../../domain/strategies/password-hasher';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SmsVerificationService } from './sms-verification.service';
import { TokenService } from './token.service';

/**
 * 管理端认证模块。
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SmsVerificationService,
    TokenService,
    JwtStrategy,
    AuditLogWriter,
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
  ],
  exports: [AuthService, TokenService, PASSWORD_HASHER, JwtModule],
})
export class AuthModule {}
