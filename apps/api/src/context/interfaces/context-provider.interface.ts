import { ContextRequest, ContextFilters } from './context-request.interface';

export interface ArtifactWithMetadata {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  title?: string;
  data: unknown;
  tags?: string[];
  category?: string;
  createdAt: Date;
  updatedAt: Date;
  sourceType: string;
  sourceId: string;
  parentId?: string;
  priority?: string;
  status?: string;
  isPublic?: boolean;
  relevanceScore?: number;
  selectionReason?: string;
}

export interface ContextResult {
  artifacts: ArtifactWithMetadata[];
  totalCount: number;
  tokenEstimate: number;
  providerName: string;
  executionTimeMs: number;
  metadata?: {
    queryStrategy?: string;
    filters?: ContextFilters;
    [key: string]: unknown;
  };
}

export interface ContextProvider {
  name: string;
  priority: number;
  supportedTypes: string[];

  canHandle(request: ContextRequest): boolean;

  resolve(
    request: ContextRequest,
    filters?: ContextFilters,
  ): Promise<ContextResult>;

  estimateTokens(artifacts: ArtifactWithMetadata[]): number;
}
