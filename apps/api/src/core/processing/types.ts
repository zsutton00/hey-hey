import { ProjectId } from 'src/types';
import { JobType } from '../events/types/event.types';
import { ClaudeModel } from 'src/services/llm/llm-shared';
import type { ModelSelectionCriteria } from 'src/services/llm/llm-types';

export interface ArtifactGenerationJobData {
  type: 'artifact';
  projectId: ProjectId;
  title?: string;
  content: string;
  nodeId?: string;
  artifactType: string;
  sourceType: string;
  sourceId: string;
  generateEmbedding?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LLMWorkflowJobData {
  type: 'llm_workflow';
  workflowType: JobType;
  prompt: string;
  options?: {
    model?: ClaudeModel;
    modelCriteria?: ModelSelectionCriteria;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    stream?: boolean;
  };
}

export type JobData = ArtifactGenerationJobData | LLMWorkflowJobData;
