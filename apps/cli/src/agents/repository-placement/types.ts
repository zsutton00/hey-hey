import type {
  RepositoryPlacementCompletion,
  RepositoryPlacementRequest,
  RepositoryPlacementSuccess,
} from '../../shared/agent-bridge-contract/generated/api';

export type RepositoryPlacementPromptPayload = RepositoryPlacementRequest;
type RepositoryPlacementResult = RepositoryPlacementCompletion;
export type RepositoryPlacementSuccessResult = RepositoryPlacementSuccess;
