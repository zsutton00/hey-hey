import type {
  RepositoryPlacementCompletion,
  RepositoryPlacementRequest,
  RepositoryPlacementSuccess,
} from '@hey-hey/contracts/agent-bridge';

export type RepositoryPlacementPromptPayload = RepositoryPlacementRequest;
type RepositoryPlacementResult = RepositoryPlacementCompletion;
export type RepositoryPlacementSuccessResult = RepositoryPlacementSuccess;
