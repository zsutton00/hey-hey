export type ContextRequestId = string & {
  readonly __brand: 'ContextRequestId';
};
export type ProviderId = string & { readonly __brand: 'ProviderId' };

export enum ProviderPriority {
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
}

export enum SelectionStrategy {
  RELEVANCE_SCORE = 'RELEVANCE_SCORE',
  RECENCY = 'RECENCY',
  USAGE_FREQUENCY = 'USAGE_FREQUENCY',
  HYBRID = 'HYBRID',
}

export interface ProviderMetrics {
  totalRequests: number;
  averageExecutionTime: number;
  successRate: number;
  lastUsed: Date;
}

export interface ContextResolutionMetrics {
  requestId: ContextRequestId;
  totalProviders: number;
  selectedProvider: string;
  executionTime: number;
  artifactsReturned: number;
  tokenEstimate: number;
}
