import {
  InputExecutionController,
  MachineInputExecutionController,
} from '../../controllers/input-execution.controller';
import { InputExecutionProjectionService } from './input-execution-projection.service';
import { Module } from '@nestjs/common';
import { AgentOperationController } from '../../controllers/agent-operation.controller';
import { WebsocketsModule } from '../../core/websockets/websockets.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ControllerAuthorizationModule } from '../controller-authorization/controller-authorization.module';
import { MachinePairingModule } from '../machine-pairing/machine-pairing.module';
import { AgentOperationRegistryService } from './agent-operation-registry.service';
import { AgentOperationSubmissionService } from './agent-operation-submission.service';
import { AgentOperationWorkflowAnswerService } from './agent-operation-workflow-answer.service';
import { AgentOperationWorkflowInputDeliveryService } from './agent-operation-workflow-input-delivery.service';

@Module({
  imports: [
    PrismaModule,
    ControllerAuthorizationModule,
    WebsocketsModule,
    MachinePairingModule,
  ],
  controllers: [
    AgentOperationController,
    InputExecutionController,
    MachineInputExecutionController,
  ],
  providers: [
    InputExecutionProjectionService,
    AgentOperationRegistryService,
    AgentOperationSubmissionService,
    AgentOperationWorkflowAnswerService,
    AgentOperationWorkflowInputDeliveryService,
  ],
  exports: [
    AgentOperationRegistryService,
    AgentOperationSubmissionService,
    AgentOperationWorkflowAnswerService,
  ],
})
export class AgentOperationModule {}
