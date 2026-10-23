import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { SharedSetupIntegrationsNode } from './shared-setup-integrations.node';
import { SharedBusinessDiscoveryNode } from './shared-business-discovery.node';
import { SharedTechnicalDiscoveryNode } from './shared-technical-discovery.node';
import { SharedTechnicalDiscoveryMatureNode } from './shared-technical-discovery-mature.node';
import { SharedIntegrationDiscoveryNode } from './shared-integration-discovery.node';
import { SharedAssessImplementationNode } from './shared-assess-implementation.node';
import { SharedAddressConcernsNode } from './shared-address-concerns.node';
import { SharedAnalyzeProjectNode } from './shared-analyze-project.node';
import { SharedProjectMembersNode } from './shared-project-members.node';
import { SharedPoliteRedirectNode } from './shared-polite-redirect.node';
import { SharedGenerateArtifactsNode } from './shared-generate-artifacts.node';
import { SharedSuggestedActionsGenerateTaskNode } from './suggested-actions/generate-task.node';

/**
 * Module for shared flow nodes
 *
 * Registers all shared nodes (used across multiple flows)
 * with the NodeRegistry during module initialization.
 */
@Module({
  providers: [
    SharedSetupIntegrationsNode,
    SharedBusinessDiscoveryNode,
    SharedTechnicalDiscoveryNode,
    SharedTechnicalDiscoveryMatureNode,
    SharedIntegrationDiscoveryNode,
    SharedAssessImplementationNode,
    SharedAddressConcernsNode,
    SharedAnalyzeProjectNode,
    SharedProjectMembersNode,
    SharedPoliteRedirectNode,
    SharedGenerateArtifactsNode,
    SharedSuggestedActionsGenerateTaskNode,
  ],
  exports: [
    SharedSetupIntegrationsNode,
    SharedBusinessDiscoveryNode,
    SharedTechnicalDiscoveryNode,
    SharedTechnicalDiscoveryMatureNode,
    SharedIntegrationDiscoveryNode,
    SharedAssessImplementationNode,
    SharedAddressConcernsNode,
    SharedAnalyzeProjectNode,
    SharedProjectMembersNode,
    SharedPoliteRedirectNode,
    SharedGenerateArtifactsNode,
    SharedSuggestedActionsGenerateTaskNode,
  ],
})
export class SharedNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private setupIntegrationsNode: SharedSetupIntegrationsNode,
    private businessDiscoveryNode: SharedBusinessDiscoveryNode,
    private technicalDiscoveryNode: SharedTechnicalDiscoveryNode,
    private technicalDiscoveryMatureNode: SharedTechnicalDiscoveryMatureNode,
    private integrationDiscoveryNode: SharedIntegrationDiscoveryNode,
    private assessImplementationNode: SharedAssessImplementationNode,
    private addressConcernsNode: SharedAddressConcernsNode,
    private analyzeProjectNode: SharedAnalyzeProjectNode,
    private projectMembersNode: SharedProjectMembersNode,
    private politeRedirectNode: SharedPoliteRedirectNode,
    private generateArtifactsNode: SharedGenerateArtifactsNode,
    private suggestedActionsGenerateTaskNode: SharedSuggestedActionsGenerateTaskNode,
  ) {}

  onModuleInit() {
    // Register all shared nodes with the registry
    this.nodeRegistry.register(this.setupIntegrationsNode);
    this.nodeRegistry.register(this.businessDiscoveryNode);
    this.nodeRegistry.register(this.technicalDiscoveryNode);
    this.nodeRegistry.register(this.technicalDiscoveryMatureNode);
    this.nodeRegistry.register(this.integrationDiscoveryNode);
    this.nodeRegistry.register(this.assessImplementationNode);
    this.nodeRegistry.register(this.addressConcernsNode);
    this.nodeRegistry.register(this.analyzeProjectNode);
    this.nodeRegistry.register(this.projectMembersNode);
    this.nodeRegistry.register(this.politeRedirectNode);
    this.nodeRegistry.register(this.generateArtifactsNode);
    this.nodeRegistry.register(this.suggestedActionsGenerateTaskNode);
  }
}
