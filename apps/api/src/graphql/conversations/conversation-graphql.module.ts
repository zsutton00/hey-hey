import { Module } from '@nestjs/common';
import { WorkflowModule } from '../../services/workflows/workflow.module';
import { ConversationResolver } from './conversation.resolver';

/** Conversation and message reads on the Web UI GraphQL endpoint. */
@Module({
  imports: [WorkflowModule],
  providers: [ConversationResolver],
})
export class ConversationGraphqlModule {}
