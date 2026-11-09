import type {
  RepositoryFirstWorkCompletion,
  RepositoryFirstWorkRequest,
} from '@hey-hey/contracts/agent-bridge';

export type RepositoryFirstWorkPromptPayload = RepositoryFirstWorkRequest;
type RepositoryFirstWorkResult = RepositoryFirstWorkCompletion;

export type RepositoryFirstWorkParseResult =
  | { ok: true; value: RepositoryFirstWorkResult }
  | { ok: false; error: string };
