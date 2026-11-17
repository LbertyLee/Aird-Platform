import { Module } from '@nestjs/common';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

/**
 * 角色权限模块。
 */
@Module({
  controllers: [RbacController],
  providers: [RbacService, AuditLogWriter],
  exports: [RbacService],
})
export class RbacModule {}
