/**
 * Workflow Monitoring Module
 *
 * Provides Phase 3 advanced workflow orchestration and monitoring capabilities
 * including health monitoring, context management, and agent coordination.
 */

import { Module, Global } from '@nestjs/common';
import { WorkflowHealthController } from '../controllers/workflow-health.controller';
import { WorkflowContextController } from '../controllers/workflow-context.controller';
import { WorkflowMetricsCollector } from '../workflows/monitoring/workflow-metrics-collector';
import { WorkflowHealthChecker } from '../workflows/monitoring/workflow-health-checker';
import { ContextVersionManager } from '../workflows/context/context-version-manager';
import { ContextSharingManager } from '../workflows/context/context-sharing-manager';
import { ContextTransformationPipeline } from '../workflows/context/context-transformation-pipeline';
import { AgentCoordinationSystem } from '../workflows/coordination/agent-coordination-system';

@Global()
@Module({
  controllers: [WorkflowHealthController, WorkflowContextController],
  providers: [
    // Phase 3 Monitoring Services
    {
      provide: WorkflowMetricsCollector,
      useFactory: () => {
        return new WorkflowMetricsCollector();
      },
    },
    {
      provide: WorkflowHealthChecker,
      useFactory: (metricsCollector: WorkflowMetricsCollector) => {
        return new WorkflowHealthChecker(metricsCollector, {
          // Production configuration
          maxExecutionTime: 300000, // 5 minutes
          maxErrorRate: 5, // 5%
          maxMemoryUtilization: 80, // 80%
          maxSignalQueueLength: 100,
          minAgentSuccessRate: 90, // 90%
          healthCheckInterval: 30000, // 30 seconds
          metricsAggregationWindow: 300000, // 5 minutes
          alertCooldownPeriod: 60000, // 1 minute
          maxActiveAlerts: 50,
        });
      },
      inject: [WorkflowMetricsCollector],
    },

    // Phase 3 Context Management Services
    {
      provide: ContextVersionManager,
      useFactory: () => {
        return new ContextVersionManager();
      },
    },
    {
      provide: ContextSharingManager,
      useFactory: () => {
        return new ContextSharingManager();
      },
    },
    {
      provide: ContextTransformationPipeline,
      useFactory: () => {
        return new ContextTransformationPipeline();
      },
    },

    // Phase 3 Agent Coordination Services
    {
      provide: AgentCoordinationSystem,
      useFactory: () => {
        return new AgentCoordinationSystem();
      },
    },

    // Token-based providers for dependency injection
    {
      provide: 'WORKFLOW_METRICS_COLLECTOR',
      useExisting: WorkflowMetricsCollector,
    },
    {
      provide: 'WORKFLOW_HEALTH_CHECKER',
      useExisting: WorkflowHealthChecker,
    },
    {
      provide: 'CONTEXT_VERSION_MANAGER',
      useExisting: ContextVersionManager,
    },
    {
      provide: 'CONTEXT_SHARING_MANAGER',
      useExisting: ContextSharingManager,
    },
    {
      provide: 'CONTEXT_TRANSFORMATION_PIPELINE',
      useExisting: ContextTransformationPipeline,
    },
  ],
  exports: [
    // Export all services for use in other modules
    WorkflowMetricsCollector,
    WorkflowHealthChecker,
    ContextVersionManager,
    ContextSharingManager,
    ContextTransformationPipeline,

    // Export tokens for dependency injection
    'WORKFLOW_METRICS_COLLECTOR',
    'WORKFLOW_HEALTH_CHECKER',
    'CONTEXT_VERSION_MANAGER',
    'CONTEXT_SHARING_MANAGER',
    'CONTEXT_TRANSFORMATION_PIPELINE',
    'AGENT_COORDINATION_SYSTEM',
  ],
})
export class WorkflowMonitoringModule {}

// Optional: Service factory for custom configurations
export class WorkflowMonitoringServiceFactory {
  static createMetricsCollector(): WorkflowMetricsCollector {
    return new WorkflowMetricsCollector();
  }

  static createHealthChecker(
    metricsCollector: WorkflowMetricsCollector,
    config?: any,
  ): WorkflowHealthChecker {
    return new WorkflowHealthChecker(metricsCollector, config);
  }

  static createContextVersionManager(): ContextVersionManager {
    return new ContextVersionManager();
  }

  static createContextSharingManager(): ContextSharingManager {
    return new ContextSharingManager();
  }

  static createContextTransformationPipeline(): ContextTransformationPipeline {
    return new ContextTransformationPipeline();
  }
}

// Configuration interface for module setup
export interface WorkflowMonitoringConfig {
  health?: {
    maxExecutionTime?: number;
    maxErrorRate?: number;
    maxMemoryUtilization?: number;
    healthCheckInterval?: number;
    alertCooldownPeriod?: number;
  };
  context?: {
    maxVersions?: number;
    compressionEnabled?: boolean;
    encryptionEnabled?: boolean;
  };
  coordination?: {
    defaultMaxAgents?: number;
    defaultResourceLimits?: any;
    loadBalancingEnabled?: boolean;
  };
}
