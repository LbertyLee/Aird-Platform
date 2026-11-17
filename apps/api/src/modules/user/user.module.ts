import { Module } from '@nestjs/common';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { AuthModule } from '../auth/auth.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * 用户管理模块。
 */
@Module({
  imports: [AuthModule],
  controllers: [UserController],
  providers: [UserService, AuditLogWriter],
  exports: [UserService],
})
export class UserModule {}
