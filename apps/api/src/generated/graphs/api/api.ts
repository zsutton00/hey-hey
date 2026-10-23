export * from './admin.service';
import { AdminService } from './admin.service';
export * from './agentEdges.service';
import { AgentEdgesService } from './agentEdges.service';
export * from './hints.service';
import { HintsService } from './hints.service';
export * from './lifecycle.service';
import { LifecycleService } from './lifecycle.service';
export * from './nodes.service';
import { NodesService } from './nodes.service';
export * from './queries.service';
import { QueriesService } from './queries.service';
export * from './relationships.service';
import { RelationshipsService } from './relationships.service';
export * from './templateGraph.service';
import { TemplateGraphService } from './templateGraph.service';
export const APIS = [
  AdminService,
  AgentEdgesService,
  HintsService,
  LifecycleService,
  NodesService,
  QueriesService,
  RelationshipsService,
  TemplateGraphService,
];
