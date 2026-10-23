import { Global, Module, forwardRef } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebsocketsModule } from '../../core/websockets/websockets.module';
import { StagedContentModule } from '../../modules/staged-content.module';
import { ServiceModule } from '../service/service.module';
import { PhaseBreakdownMaterializationService } from './phase-breakdown-materialization.service';
import { PlanFromDesignDocSeedService } from './plan-from-design-doc-seed.service';
import { PlanFromDesignDocLauncherService } from './plan-from-design-doc-launcher.service';
import { WorkItemPlanGenerationService } from './work-item-plan-generation.service';
import { WorkflowModule } from '../workflows/workflow.module';
import { PlanSubmissionAdmissionService } from './plan-submission-admission.service';

// @Global so canonical Plan generation is reachable from CoreDomainModule providers
// (e.g. ProposalApprovalService) without creating an import cycle through
// StagedContentModule, which already imports CoreDomainModule.
@Global()
@Module({
  imports: [
    CoreModule,
    PrismaModule,
    WebsocketsModule,
    StagedContentModule,
    ServiceModule,
    forwardRef(() => WorkflowModule),
  ],
  providers: [
    PhaseBreakdownMaterializationService,
    PlanFromDesignDocSeedService,
    PlanFromDesignDocLauncherService,
    WorkItemPlanGenerationService,
    PlanSubmissionAdmissionService,
  ],
  exports: [
    PhaseBreakdownMaterializationService,
    PlanFromDesignDocSeedService,
    PlanFromDesignDocLauncherService,
    WorkItemPlanGenerationService,
    PlanSubmissionAdmissionService,
  ],
})
export class PlanModule {}
