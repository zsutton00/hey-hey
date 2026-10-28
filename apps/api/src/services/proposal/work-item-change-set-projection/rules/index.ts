import type { AnyProjectionRule } from '../projection-rule';
import {
  diagramGroupsRule,
  diagramMetadataRule,
  diagramUxFlowRule,
} from './diagram-rules';
import {
  nodeParentageRule,
  nodeRequiredScalarsRule,
  nodeStatusRule,
  nodeTypeActiveRule,
  nodeUpdatedScalarsRule,
  planStageChildRule,
  sectionSchemaRule,
} from './node-rules';
import {
  identityBoundaryRule,
  layoutIdentityUniqueRule,
  nameCollisionRule,
} from './reference-rules';
import {
  dependencyTopologyRule,
  featureRequirementsRule,
  layoutBoundaryRule,
  planDependenciesBoundaryRule,
  planDependenciesChainRule,
  relationshipEndpointsRule,
  relationshipExistenceRule,
} from './relationship-rules';
import {
  layoutSectionKeyRule,
  opRefResolvesRule,
  opTypeAvailableRule,
  refExistenceRule,
  requestTempRefsRule,
  sectionClearRule,
  serviceRefsRule,
} from './request-rules';

/** Rules on the declared-applicability contract, in run order. */
export const PROJECTION_RULES: readonly AnyProjectionRule[] = [
  diagramMetadataRule,
  diagramUxFlowRule,
  diagramGroupsRule,
  requestTempRefsRule,
  refExistenceRule,
  relationshipExistenceRule,
  opTypeAvailableRule,
  opRefResolvesRule,
  sectionClearRule,
  layoutSectionKeyRule,
  serviceRefsRule,
  identityBoundaryRule,
  layoutIdentityUniqueRule,
  nameCollisionRule,
  nodeTypeActiveRule,
  nodeParentageRule,
  nodeRequiredScalarsRule,
  nodeUpdatedScalarsRule,
  nodeStatusRule,
  sectionSchemaRule,
  planStageChildRule,
  featureRequirementsRule,
  relationshipEndpointsRule,
  dependencyTopologyRule,
  planDependenciesBoundaryRule,
  planDependenciesChainRule,
  layoutBoundaryRule,
];
