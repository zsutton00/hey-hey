import type {
  RepositoryGroundingCompletion,
  RepositoryGroundingDeterministicBounds,
  RepositoryGroundingHierarchy,
  RepositoryGroundingRequest,
  RepositoryGroundingScope,
  RepositoryGroundingSuccess,
} from '../../shared/agent-bridge-contract/generated/api';

/** The generated request is shared by start-run and direct trigger envelopes. */
export type RepositoryAnalysisPromptPayload = RepositoryGroundingRequest;
export type RepositoryAnalysisBounds = RepositoryGroundingDeterministicBounds;
type RepositoryAnalysisScope = RepositoryGroundingScope;
type RepositoryAnalysisHierarchy = RepositoryGroundingHierarchy;
export type RepositoryAnalysisSuccess = RepositoryGroundingSuccess;
export type RepositoryAnalysisCompletion = RepositoryGroundingCompletion;
type RepositoryAnalysisFailure = Exclude<RepositoryGroundingCompletion, RepositoryGroundingSuccess>;
