import type {
  RepositoryFirstWorkCompletion,
  RepositoryFirstWorkRequest,
} from '../../shared/agent-bridge-contract/generated/api';

export type RepositoryFirstWorkPromptPayload = RepositoryFirstWorkRequest;
type RepositoryFirstWorkResult = RepositoryFirstWorkCompletion;

export type RepositoryFirstWorkParseResult =
  | { ok: true; value: RepositoryFirstWorkResult }
  | { ok: false; error: string };
