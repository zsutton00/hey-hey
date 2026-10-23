import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ContextModule } from '../../context/context.module';
import { AgentCostTrackingService } from '../../services/agents/agent-cost-tracking.service';
import { MastraClientService } from '../../services/agents/mastra-client.service';
import { JobEnqueueingService } from '../../services/job-enqueuing.service';
import {
  JOB_ENQUEUER_TOKEN,
  JOB_PROCESSOR_TOKEN,
} from '../../services/job.tokens';
import { MessageClassificationService } from '../../services/message-classification/message-classification.service';
import { NotificationService } from '../../services/notifications/notification.service';
// LlmModule merged into WorkflowModule
import { WorkflowModule } from '../../services/workflows/workflow.module';
import { PlanModule } from '../../services/plan/plan.module';
import { EntityRelationshipResolverService } from '../../services/relationships/entity-relationship-resolver.service';
import { WebsocketsModule } from '../websockets/websockets.module';
import { AgentProcessor } from './agent-processor.service';
import { ArtifactProcessor } from './artifact-processor.service';
import { CoreProcessor } from './core-processor.service';
import { FlowNodeErrorRecoveryService } from '../../services/workflows/flow-node-error-recovery.service';
import { FlowNodeProcessor } from './flow-node-processor.service';
import { LlmProcessor } from './llm-processor.service';
import { MessageProcessor } from './message-processor.service';
import { NonInteractiveFlowNodeProcessor } from './non-interactive-flow-node-processor.service';
import { NotificationGenerationProcessor } from './notification-generation-processor.service';

@Global()
@Module({
  imports: [
    WorkflowModule,
    AuthModule,
    ContextModule,
    PlanModule,
    WebsocketsModule,
  ],
  providers: [
    AgentCostTrackingService,
    AgentProcessor,
    ArtifactProcessor,
    FlowNodeErrorRecoveryService,
    FlowNodeProcessor,
    NonInteractiveFlowNodeProcessor,
    JobEnqueueingService,
    LlmProcessor,
    MastraClientService,
    MessageClassificationService,
    MessageProcessor,
    NotificationService,
    NotificationGenerationProcessor,
    EntityRelationshipResolverService,
    CoreProcessor,
    {
      provide: JOB_ENQUEUER_TOKEN,
      useExisting: JobEnqueueingService,
    },
    {
      provide: JOB_PROCESSOR_TOKEN,
      useExisting: CoreProcessor,
    },
  ],
  exports: [
    AgentCostTrackingService,
    AgentProcessor,
    ArtifactProcessor,
    FlowNodeErrorRecoveryService,
    FlowNodeProcessor,
    NonInteractiveFlowNodeProcessor,
    JobEnqueueingService,
    LlmProcessor,
    MastraClientService,
    MessageClassificationService,
    MessageProcessor,
    NotificationService,
    NotificationGenerationProcessor,
    EntityRelationshipResolverService,
    CoreProcessor,
    JOB_ENQUEUER_TOKEN,
    JOB_PROCESSOR_TOKEN,
  ],
})
export class ProcessingModule {}
