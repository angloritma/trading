import { Module } from '@nestjs/common';
import { AgentApiController } from './agent-api.controller';
import { AgentModule } from '../../agent/agent.module';

@Module({
  imports: [AgentModule],
  controllers: [AgentApiController],
})
export class AgentApiModule {}

