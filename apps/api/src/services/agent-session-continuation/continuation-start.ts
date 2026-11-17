import type {
  AgentSessionContinuationMarker,
  AgentSessionHostActionPreparation,
  ControllerStartInputs,
  HostActionPreparation,
  StartRunPromptPayload,
} from '@hey-hey/contracts/api/models';

export type ContinuationStartPreparation = AgentSessionHostActionPreparation & {
  inputs: ControllerStartInputs & {
    payload: StartRunPromptPayload & {
      continuation: AgentSessionContinuationMarker;
    };
  };
};

/** A materialize-only start_run authored for one inspected continuation. */
export function isContinuationStart(
  action: HostActionPreparation,
): action is ContinuationStartPreparation {
  return (
    action.targetKind === 'AGENT_SESSION' &&
    action.inputs?.kind === 'START_RUN' &&
    action.inputs.payload.continuation !== undefined
  );
}
