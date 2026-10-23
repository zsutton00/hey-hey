import { Module, OnModuleInit } from '@nestjs/common';
import { ContextModule } from '../../../context/context.module';
import { MachinePairingModule } from '../../../services/machine-pairing/machine-pairing.module';
import { WorkItemModule } from '../../../services/work-item.module';
import { FeatureListLifecycleService } from '../../../services/feature-list/feature-list-lifecycle.service';
import { NodeRegistry } from '../node-registry.service';
import {
  WorkTrackerImportConfigurationNode,
  WorkTrackerImportConnectConfirmNode,
  WorkTrackerImportStartNode,
} from './work-tracker-import-setup.nodes';
import {
  WorkTrackerImportConnectNode,
  WorkTrackerImportImportNode,
} from './work-tracker-import-agent.nodes';
import {
  WorkTrackerImportEndNode,
  WorkTrackerImportFinalizeNode,
  WorkTrackerImportGenerateFeaturesNode,
  WorkTrackerImportPlacementStrategyNode,
} from './work-tracker-import-review.nodes';

const providers = [
  FeatureListLifecycleService,
  WorkTrackerImportConfigurationNode,
  WorkTrackerImportConnectNode,
  WorkTrackerImportConnectConfirmNode,
  WorkTrackerImportStartNode,
  WorkTrackerImportImportNode,
  WorkTrackerImportGenerateFeaturesNode,
  WorkTrackerImportPlacementStrategyNode,
  WorkTrackerImportFinalizeNode,
  WorkTrackerImportEndNode,
];

@Module({
  imports: [ContextModule, WorkItemModule, MachinePairingModule],
  providers,
  exports: providers,
})
export class WorkTrackerImportNodesModule implements OnModuleInit {
  constructor(
    private readonly registry: NodeRegistry,
    private readonly configuration: WorkTrackerImportConfigurationNode,
    private readonly connect: WorkTrackerImportConnectNode,
    private readonly connectConfirm: WorkTrackerImportConnectConfirmNode,
    private readonly start: WorkTrackerImportStartNode,
    private readonly importNode: WorkTrackerImportImportNode,
    private readonly generateFeatures: WorkTrackerImportGenerateFeaturesNode,
    private readonly placementStrategy: WorkTrackerImportPlacementStrategyNode,
    private readonly finalize: WorkTrackerImportFinalizeNode,
    private readonly end: WorkTrackerImportEndNode,
  ) {}

  onModuleInit(): void {
    [
      this.configuration,
      this.connect,
      this.connectConfirm,
      this.start,
      this.importNode,
      this.generateFeatures,
      this.placementStrategy,
      this.finalize,
      this.end,
    ].forEach((node) => this.registry.register(node));
  }
}
