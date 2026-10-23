/**
 * WorkerAppModule - Module for Temporal Worker Context
 *
 * Provides worker-specific assembly that reuses shared domain, workflow,
 * and processing modules while wiring Temporal worker infrastructure.
 */
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ContextModule } from './context/context.module';
import { WorkerCoreModule } from './core/worker-core.module';
import { ProcessingModule } from './core/processing/processing.module';
import { WorkerDomainModule } from './domain/worker-domain.module';
import { WorkflowModule } from './services/workflows/workflow.module';
import { StagedContentModule } from './modules/staged-content.module';

@Module({
  imports: [
    WorkerCoreModule,
    WorkerDomainModule,
    WorkflowModule,
    ProcessingModule,
    ContextModule,
    HttpModule,
    StagedContentModule,
  ],
  providers: [
    {
      provide: 'DEBUG_LOGGER',
      useFactory: () => {
        return null;
      },
    },
  ],
  exports: [WorkerDomainModule, WorkflowModule, ProcessingModule],
})
export class WorkerAppModule {}
