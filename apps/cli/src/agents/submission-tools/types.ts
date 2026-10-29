/**
 * Types for EXTERNAL_AGENT submission tools.
 *
 * A submission tool is a typed tool the CLI exposes to a local agent during
 * an EXTERNAL_AGENT turn. When the agent invokes the tool, the CLI posts an
 * agent-authored completion message carrying the matching `action` payload to
 * the conversation, so the server's flow engine advances on that action.
 *
 * Two tool variants are supported:
 *
 * - `'action'` (default): the tool's `execute()` returns a `SubmissionToolAction`
 *   that the HTTP MCP layer posts to the conversation as a completion message.
 *   Requires EXTERNAL_AGENT context (externalAgentNodeId + triggerMessageId).
 *
 * - `'pass_through'`: the tool's `execute()` returns an MCP content payload
 *   directly. The HTTP MCP layer skips action posting and returns the payload
 *   to the agent verbatim. Used to wrap platform-side MCP tools (e.g.
 *   `create_report`) with CLI-side bookkeeping.
 */

// `Run` is forward-declared as a type-only import to avoid a runtime cycle:
// `Run` itself imports from this file. `import type` is erased at compile time
// so no module resolution actually happens at runtime.
import type { Run } from '../../run/run';

/**
 * A JSON-schema-compatible object describing a submission tool's input.
 * Hand-authored JSON Schema works directly; Zod users pass the output of
 * `z.toJSONSchema(schema)`.
 */
export type SubmissionToolInputSchema = Record<string, unknown>;

/**
 * The action payload a submission tool produces. Must match the server's
 * EXTERNAL_AGENT action contract: an `action` discriminator plus an optional
 * action-specific payload.
 *
 * The CLI posts the result as a SYSTEM message whose `data` carries `action`
 * and (optionally) `payload` verbatim — the server's flow engine reads both
 * fields directly to decide the next transition.
 */
export interface SubmissionToolAction {
  action: string;
  payload?: Record<string, unknown> | undefined;
}

/**
 * A single MCP content block returned to the agent. Mirrors the subset of the
 * MCP spec the Claude SDK consumes — a discriminated entry with at least a
 * `type` and either `text` or arbitrary structured fields.
 */
export interface SubmissionToolMcpContent {
  type: string;
  [key: string]: unknown;
}

/**
 * Result returned by a `'pass_through'` tool's `execute()`. The MCP layer
 * forwards `content` to the agent unchanged.
 */
export interface SubmissionToolPassThroughResult {
  content: ReadonlyArray<SubmissionToolMcpContent>;
}

export interface SubmissionToolExecuteContext {
  /**
   * Identifier of the agentic run this tool was invoked in. Handlers use it
   * for logging/telemetry; the action payload is opaque to the runtime.
   */
  runId: string;
  /**
   * Durable identity of the active EXTERNAL_AGENT trigger. Action tools may
   * copy this into revision-scoped completion payloads so the completion and
   * entities authored during the turn share one join key.
   */
  triggerMessageId?: string;
  /** Raw arguments fully validated against `inputSchema`. */
  args: Record<string, unknown>;
  /**
   * The active Run, surfaced for `'pass_through'` tools that need to mutate
   * Run-scoped state (e.g. `appendReportChainEntry`). Only present when the
   * runtime can resolve a Run for `runId` — `'action'` tools never read this
   * field; the dispatcher resolves it lazily for pass-through tools and
   * surfaces a typed error if resolution fails.
   */
  run?: Run;
}

/**
 * A correctable tool-call failure that must be returned to the agent without
 * completing the pending workflow node. The active agent turn may call the
 * same tool again with corrected arguments or satisfied preconditions.
 */
interface SubmissionToolCorrectableFindingDetail {
  /** Stable machine-readable classification when the producer supplies one. */
  code?: string;
  /** Why the submitted value was rejected. */
  reason: string;
  /** Concrete guidance for correcting this finding before retrying. */
  correction: string;
}

/** Every finding identifies at least one field or durable object to correct. */
export type SubmissionToolCorrectableFinding = SubmissionToolCorrectableFindingDetail &
  ({ field: string; identity?: string } | { field?: undefined; identity: string });

export interface SubmissionToolCorrectableErrorResult {
  content: ReadonlyArray<{ type: 'text'; text: string }>;
  structuredContent: {
    status: 'correctable_rejection';
    reason: string;
    findings: ReadonlyArray<SubmissionToolCorrectableFinding>;
  };
  isError: true;
}

/**
 * Deliberate admission rejection. The HTTP boundary maps this owned signal to
 * an MCP error result and leaves the active workflow trigger pending.
 */
export class SubmissionToolCorrectableError extends Error {
  public readonly reason: string;
  public readonly findings: ReadonlyArray<SubmissionToolCorrectableFinding>;

  public constructor(input: {
    reason: string;
    findings: ReadonlyArray<SubmissionToolCorrectableFinding>;
  }) {
    super(input.reason);
    this.name = 'SubmissionToolCorrectableError';
    this.reason = input.reason;
    this.findings = input.findings;
  }
}

/**
 * Common fields shared by both submission tool variants.
 */
interface SubmissionToolDeclarationBase {
  /**
   * Tool name exposed to the agent. Must be unique per handler.
   * Conventionally snake_cased (e.g. `submit_no_discrepancy`).
   */
  name: string;
  /**
   * Short, agent-facing description of when to call this tool.
   */
  description: string;
  /**
   * JSON Schema for the tool's input arguments. Defaults to empty object
   * for no-payload tools. The runtime validates arguments against this
   * schema before calling `execute`.
   */
  inputSchema: SubmissionToolInputSchema;
  /**
   * Tool-owned repair guidance for schema findings whose correct value depends
   * on context a generic JSON Schema error cannot express (e.g. a branch that
   * depends on a sibling field). Return the finding unchanged when the tool has
   * nothing more specific to say. `field` must be preserved.
   */
  correctArgumentFinding?: (
    finding: SubmissionToolCorrectableFinding & { field: string },
    args: Record<string, unknown>,
  ) => SubmissionToolCorrectableFinding & { field: string };
  /**
   * Upper bound on one call's duration, for tools that wait on long work.
   * Providers with a per-server MCP tool timeout raise it to cover this.
   */
  maxDurationMs?: number;
}

/**
 * Action-tool variant — the original submission-tool shape. `execute()`
 * returns a `SubmissionToolAction`; the HTTP MCP layer posts the resulting
 * completion message and returns canned text to the agent.
 *
 * Requires EXTERNAL_AGENT context (externalAgentNodeId + triggerMessageId)
 * to register on a Run.
 *
 * `hidden` and `userFacingResponse` are mutually exclusive: a tool either
 * opts out of a visible bubble entirely (`hidden: true`) or supplies optional
 * body text (`userFacingResponse?: string`). Declaring both is a compile-time
 * error enforced by the discriminated union below.
 */
export type ActionSubmissionToolDeclaration = SubmissionToolDeclarationBase & {
  kind?: 'action';
  /**
   * Produce the action payload that will be attached to the completion
   * message. `action` is required and becomes the discriminator the server
   * validates and routes on.
   */
  execute(ctx: SubmissionToolExecuteContext): Promise<SubmissionToolAction> | SubmissionToolAction;
} & (
    | {
        /**
         * Suppress the completion bubble entirely. The completion message still
         * carries the `completesExternalAgentNode` envelope (the workflow engine
         * needs it to advance the node), but the renderer hides it via the
         * existing `AgentHidden` UI element. Use for pure flow-transition tools
         * whose outcome the user has no reason to read.
         */
        hidden: true;
        userFacingResponse?: never;
      }
    | {
        hidden?: false | undefined;
        /**
         * User-facing text posted as the `response` field on the agent-authored
         * completion message. Defaults to an empty string — submission events are
         * system-level flow transitions, not narrative the user needs to read, and
         * leaking the internal tool name (e.g. "Submitted submit_discrepancies")
         * is noise. Handlers that want a specific user-visible string supply one
         * here.
         */
        userFacingResponse?: string;
      }
  );

/**
 * Pass-through-tool variant — the tool wraps a platform-side capability and
 * returns its response unchanged. `execute()` returns MCP content the HTTP
 * layer forwards to the agent verbatim. The MCP layer never posts an action
 * completion for these tools.
 *
 * Does not require EXTERNAL_AGENT context — useful for tools that are valid
 * outside an EXTERNAL_AGENT turn (e.g. `create_report` wrappers).
 */
export interface PassThroughSubmissionToolDeclaration extends SubmissionToolDeclarationBase {
  kind: 'pass_through';
  execute(
    ctx: SubmissionToolExecuteContext,
  ): Promise<SubmissionToolPassThroughResult> | SubmissionToolPassThroughResult;
}

/**
 * A single submission tool declaration. Handlers expose these through their
 * immutable `submissionTools` list. The discriminator on `kind` selects the
 * action-tool vs pass-through-tool surface.
 */
export type SubmissionToolDeclaration =
  | ActionSubmissionToolDeclaration
  | PassThroughSubmissionToolDeclaration;

/**
 * Narrow a declaration to the pass-through variant. Treats an absent `kind`
 * as `'action'` so existing handlers that omit the discriminator stay
 * action-typed.
 */
export const isPassThroughTool = (
  tool: SubmissionToolDeclaration,
): tool is PassThroughSubmissionToolDeclaration => tool.kind === 'pass_through';
