import type { ImplementRuntimeSelection } from '@hey-hey/contracts/agent-bridge';

/** The accepted runtime every repository-import handoff request carries. */
interface HandoffRuntimeFields {
  provider: ImplementRuntimeSelection['provider'];
  resolvedFrontierModel: string;
  reasoningEffort: NonNullable<ImplementRuntimeSelection['reasoningEffort']>;
  fastMode?: boolean;
}

/** Maps a handoff request's accepted runtime to the complete runtime the Run saves. */
export const runtimeFromHandoff = (payload: HandoffRuntimeFields): ImplementRuntimeSelection => ({
  provider: payload.provider,
  model: payload.resolvedFrontierModel,
  reasoningEffort: payload.reasoningEffort,
  ...(payload.fastMode !== undefined ? { fastMode: payload.fastMode } : {}),
});
