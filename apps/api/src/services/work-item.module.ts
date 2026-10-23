import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreDomainModule } from '../domain/core-domain.module';
import { WorkerDomainModule } from '../domain/worker-domain.module';
import { StagedContentModule } from '../modules/staged-content.module';
import { WorkflowModule } from './workflows/workflow.module';

// Controllers
import { TaskController } from '../controllers/task.controller';
import { WorkItemRefinementController } from '../controllers/work-item-refinement.controller';

// Task services
import { TaskArtifactService } from './tasks/task-artifact.service';
import { TaskOptimizationService } from './tasks/task-optimization.service';
import { TaskRefinementService } from './tasks/task-refinement.service';

import { InitiativeLifecycleService } from './initiatives/initiative-lifecycle.service';
import { InitiativeOptimizationAdapterService } from './initiatives/initiative-optimization-adapter.service';
import { InitiativeOptimizationService } from './initiatives/initiative-optimization.service';
import { InitiativeRefinementService } from './initiatives/initiative-refinement.service';

// Work item services

// Adapters
import { WorkItemStagedContentAdapter } from '../adapters/staged-content/work-item.adapter';

// Shared workflows

@Module({
  imports: [
    CoreDomainModule,
    AuthModule,
    forwardRef(() => StagedContentModule),
  ],
  controllers: [TaskController, WorkItemRefinementController],
  providers: [
    // Task services
    TaskRefinementService,
    TaskOptimizationService,
    TaskArtifactService,

    // Initiative services
    InitiativeRefinementService,
    InitiativeOptimizationService,
    InitiativeOptimizationAdapterService,
    InitiativeLifecycleService,

    // Work item services

    // Adapters
    WorkItemStagedContentAdapter,
  ],
  exports: [
    TaskRefinementService,
    TaskOptimizationService,
    TaskArtifactService,
    InitiativeRefinementService,
    InitiativeOptimizationService,
    InitiativeOptimizationAdapterService,
    InitiativeLifecycleService,
    WorkItemStagedContentAdapter,
  ],
})
export class WorkItemModule {}

@Module({
  imports: [WorkerDomainModule, WorkflowModule],
  providers: [
    TaskRefinementService,
    InitiativeRefinementService,
    InitiativeLifecycleService,
  ],
  exports: [
    TaskRefinementService,
    InitiativeRefinementService,
    InitiativeLifecycleService,
  ],
})
export class WorkerWorkItemModule {}
