import { onboardingFlow } from './templates/onboarding.flow';
import { repositoryImportFlow } from './templates/repository-import.flow';
import { workTrackerImportFlow } from './templates/work-tracker-import.flow';
import { initiativeRefinementFlow } from './templates/initiative-refinement.flow';
import { taskGenerationFlow } from './templates/task-generation.flow';
import { taskRefinementFlow } from './templates/task-refinement.flow';
import { adrRefinementFlow } from './templates/adr-refinement.flow';
import { brainstormRefinementFlow } from './templates/brainstorm-refinement.flow';
import { decisionRefinementFlow } from './templates/decision-refinement.flow';
import { taskPrioritizationFlow } from './templates/task-prioritization.flow';
import { codingPromptResearchFlow } from './templates/coding-prompt-research.flow';
import { entityConversationFlow } from './templates/entity-conversation.flow';
import { projectConversationFlow } from './templates/project-conversation.flow';
import { topologySummarizationFlow } from './templates/topology.flow';
import { topologyConsolidationFlow } from './templates/topology-consolidation.flow';
import { topologyCategorySummarizationFlow } from './templates/topology-category-summarization.flow';
import { topologySubfacetSummarizationFlow } from './templates/topology-subfacet-summarization.flow';
import { entitySummarizationFlow } from './templates/entity-summarization.flow';
import { createSuggestedTaskFlow } from './templates/create-suggested-task.flow';
import { createSuggestedDesignDocFlow } from './templates/create-suggested-design-doc.flow';
import { taskDependencyInferenceFlow } from './templates/task-dependency-inference.flow';
import { dailySessionFlow } from './templates/daily-session.flow';
import { featureSyncFlow } from './templates/feature-sync.flow';
import { planFromDesignDocFlow } from './templates/plan-from-design-doc.flow';

/**
 * Note: workflows must be registered in WorkflowTypeRegistryService in order to be runnable.
 */
export const templates = [
  onboardingFlow,
  repositoryImportFlow,
  workTrackerImportFlow,
  initiativeRefinementFlow,
  taskGenerationFlow,
  taskPrioritizationFlow,
  taskRefinementFlow,
  adrRefinementFlow,
  brainstormRefinementFlow,
  decisionRefinementFlow,
  codingPromptResearchFlow,
  entityConversationFlow,
  projectConversationFlow,
  topologySummarizationFlow,
  topologyConsolidationFlow,
  topologyCategorySummarizationFlow,
  topologySubfacetSummarizationFlow,
  entitySummarizationFlow,
  createSuggestedTaskFlow,
  createSuggestedDesignDocFlow,
  taskDependencyInferenceFlow,
  dailySessionFlow,
  featureSyncFlow,
  planFromDesignDocFlow,
];
