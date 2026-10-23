import { WorkflowName } from "../../api";
import { getMethodConfig } from "./sessionMethodRegistry";
import type { SessionMethod } from "./types";

const WORKFLOW_NAME_VALUES = new Set<string>(Object.values(WorkflowName));

/**
 * Narrow a raw workflow-name string (e.g. `conversation.workflowName`, typed as
 * `string` off the wire) to the {@link WorkflowName} union, failing closed to
 * `undefined` on any value the union does not recognize. Lets consumers feed the
 * conversation's durable workflow identity into the coding session without
 * hand-rolling an unsafe cast.
 */
export function toWorkflowName(
  value: string | null | undefined
): WorkflowName | undefined {
  if (value && WORKFLOW_NAME_VALUES.has(value)) {
    return value as WorkflowName;
  }
  return undefined;
}

export function resolveCodingSessionWorkflowType(
  method: SessionMethod
): WorkflowName;
export function resolveCodingSessionWorkflowType(
  method: SessionMethod | undefined,
  override: WorkflowName | undefined
): WorkflowName | undefined;
/**
 * Resolve the coding session's {@link WorkflowName}.
 *
 * `override` takes precedence whenever it is defined: it is the durable
 * workflow identity read off the conversation, which survives a page reload,
 * whereas `method` is reconstructed from URL query params and is lost on
 * reload. Callers that only have the launch-time `method` (no conversation
 * loaded yet) use the single-arg overload and always get a concrete
 * `WorkflowName`. The two-arg overload returns `undefined` only when neither a
 * resolvable `method` nor an `override` is available.
 *
 * The per-method routing is read from {@link SESSION_METHOD_REGISTRY}: rows
 * with a `dispatch.kind === "workflow"` arm return their declared workflow
 * name; handler-arm rows return the generic `AgentSession` workflow.
 */
export function resolveCodingSessionWorkflowType(
  method?: SessionMethod,
  override?: WorkflowName
): WorkflowName | undefined {
  if (override) {
    return override;
  }
  if (!method) {
    return undefined;
  }
  const dispatch = getMethodConfig(method).dispatch;
  return dispatch.kind === "workflow"
    ? dispatch.workflowName
    : WorkflowName.AgentSession;
}

/**
 * True when a coding session's launch is owned by a Temporal-orchestrated
 * workflow (FeatureSync today; others as they migrate) rather than the CLI
 * start-run rail. For these the workflow parks at an EXTERNAL_AGENT node and
 * mints its own agent trigger when signaled, so the UI must NOT also fire a
 * start-run — that would be a redundant second launch. The workflow-signalling
 * USER post is the sole launch. Only the `AgentSession` ('agent-session')
 * workflow uses the start-run rail.
 *
 * Reads from the registry's dispatch arm directly so adding a workflow-bound
 * method is one declaration in one place.
 */
export function isWorkflowOrchestratedLaunch(method: SessionMethod): boolean {
  return getMethodConfig(method).dispatch.kind === "workflow";
}
