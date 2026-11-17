import { Module } from '@nestjs/common';
import { MembershipModule } from '../membership/membership.module';
import { AgentController, AgentAdminController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [MembershipModule],
  controllers: [AgentController, AgentAdminController],
  providers: [AgentService],
})
export class AgentModule {}
