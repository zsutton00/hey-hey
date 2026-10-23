import {
  MessageType,
  LocalPromptType,
  type AgentSkillSelection,
  type RunAttachmentReference,
  type ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
  type CreateUserMessage,
  type ImplementRuntimeSelection,
  type SecondaryActionHandler,
  type UserMessageAgentInput,
  type UserMessageDataCodeReview,
  type UserMessageDataCommit,
  type UserMessageData,
  type UserMessageDataType,
} from "../../../../api/index";
import type { BoundDirectTriggerInput } from "../../operations/AgentOperationCoordinator";

export interface FollowupAgentOverride {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  fastMode?: boolean;
}

export const CODE_REVIEW_DISPLAY_TEXT =
  "Review the changes made during this session";

/** Builds the durable, human-facing text for a Review USER message. */
export const buildCodeReviewDisplayText = (
  additionalInstructions: string,
): string => {
  const trimmedInstructions = additionalInstructions.trim();
  return trimmedInstructions
    ? `${CODE_REVIEW_DISPLAY_TEXT}\n\n${trimmedInstructions}`
    : CODE_REVIEW_DISPLAY_TEXT;
};

const OVERRIDE_PROMPT_TYPES = new Set<LocalPromptType>([
  LocalPromptType.CodeReview,
  LocalPromptType.Commit,
]);

/**
 * Pins an object literal to one arm of the `UserMessageAgentInput` discriminated
 * union. `UserMessageData` carries an `[key: string]: any` index signature, so
 * an `agentInput` authored directly on the bag would silently accept off-spec
 * keys (`handlerPromptType`, a top-level `promptType`, ad-hoc follow-up keys).
 * Routing the arm through this identity helper makes the literal an
 * excess-property check against the union, so those keys are a compile error at
 * the construction site. Exactly one of `promptType` or `workflowName` selects
 * the arm; the user's text rides `userMessage` and the spec-canonical typed
 * fields ride the matching arm.
 */
export const buildAgentInput = (
  arm: UserMessageAgentInput,
): UserMessageAgentInput => arm;

/**
 * Builds the `agentInput` arm for a follow-up turn, where the routing key is a
 * runtime `LocalPromptType` resolved from the live conversation rather than a
 * literal. A follow-up rides on the CLI's already-loaded run state, so it
 * carries only the routing `promptType` and the user's text — none of the
 * bootstrap typed fields the start-run arms require. The runtime value spans
 * arms with conflicting required fields and so cannot narrow to a single arm at
 * compile time; the assertion is contained here.
 */
export const buildFollowupAgentInput = (
  promptType: LocalPromptType,
  userMessage: string,
  agentOverride?: FollowupAgentOverride,
  skillSelection?: AgentSkillSelection,
): UserMessageAgentInput => {
  const agentInput = {
    promptType,
    userMessage,
    ...(skillSelection ? { skillSelection } : {}),
  } as UserMessageDataCommit | UserMessageDataCodeReview;
  if (!agentOverride || !OVERRIDE_PROMPT_TYPES.has(promptType)) {
    return agentInput;
  }
  const { provider, model, reasoningEffort, fastMode } = agentOverride;
  const runtime: ImplementRuntimeSelection = {
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  };
  const withRuntime: UserMessageDataCommit | UserMessageDataCodeReview = {
    ...agentInput,
    runtime,
  };
  return withRuntime;
};

/**
 * The sanctioned authoring shape for a USER-message `data` body. The generated
 * `UserMessageData` carries an `[key: string]: any` index signature — required
 * so the freeform `round{N}_{fieldName}` form bag (plus server-read extras like
 * `references`, `attachUserMessageData`, `userMessageData`, `triggerMessageId`)
 * can ride at the data root — but `any` also silently accepts the legacy
 * `data.payload + data.promptType` dispatch envelope this surface migrated away
 * from. This input type keeps the bag open (`[key: string]: unknown`) so those
 * freeform extras still compile, while pinning the legacy dispatch fields to
 * `never`: writing `payload`, a root-level `promptType`, `handlerPromptType`, or
 * the server-stamped-only `triggersAgent` is a compile error. The typed dispatch
 * instruction the CLI routes on must instead ride the nested `agentInput`
 * envelope (built via `buildAgentInput` / `buildFollowupAgentInput`).
 */
export type BuildUserMessageDataInput = {
  [key: string]: unknown;
  type?: UserMessageDataType;
  comment?: string;
  agentInput?: UserMessageAgentInput;
  attachments?: RunAttachmentReference[];
  /** Legacy dispatch envelope — never at the data root; use `agentInput`. */
  payload?: never;
  /** Dispatch discriminator — never at the data root; lives on `agentInput`. */
  promptType?: never;
  /** Legacy handler routing key — never at the data root; lives on `agentInput`. */
  handlerPromptType?: never;
  /** Server-stamped only; the UI never authors the agent trigger. */
  triggersAgent?: never;
};

/**
 * The only sanctioned way to construct a USER-message `data` body in production
 * code. Returns the generated `UserMessageData` the wire expects, but forces the
 * call site through {@link BuildUserMessageDataInput} so a future emit site
 * cannot reintroduce the legacy `data.payload`/`data.promptType` envelope without
 * a `tsc` error. `freeform` carries a runtime-built bag (e.g. the form-response
 * `round{N}_` keys resolved from a live conversation) that cannot be authored as
 * a checked literal; it is spread underneath `input` so the typed fields win.
 */
export const buildUserMessageData = (
  input: BuildUserMessageDataInput,
  freeform?: Record<string, unknown>,
): UserMessageData =>
  (freeform ? { ...freeform, ...input } : input) as UserMessageData;

export type ReplyMessageBuilder = (
  text: string,
  skillSelection?: AgentSkillSelection,
  attachments?: RunAttachmentReference[],
) => CreateUserMessage;

export interface BuildDirectTriggerInputParams {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  // The freeform USER-message bag, authored against the typed barrier so the
  // legacy `data.payload`/root-`promptType` envelope is a compile error. The
  // typed dispatch instruction the CLI routes on rides in the nested
  // `agentInput` envelope (built via `buildAgentInput` / `buildFollowupAgentInput`);
  // the freeform extras (`references`, `attachUserMessageData`, `userMessageData`,
  // `comment`, the `round{N}_` keys) stay on the bag itself. `data.triggersAgent`
  // is server-stamped only and is never set here.
  data: BuildUserMessageDataInput;
  /** Optional secondary-action handler key routed on the CreateUserMessage envelope. */
  handler?: SecondaryActionHandler;
}

/**
 * Authors the coordinator input for a USER message with the supplied
 * `data` payload. Used by surfaces that historically pushed a workflow-defined
 * prompt down the local-CLI rail and now route through the platform's
 * conversation tail — the server's UserMessageCreated handler emits the
 * SYSTEM `triggersAgent` sibling that resumes the CLI.
 *
 * parentMessageId is sent as explicit null so the server resolves the
 * conversation tail atomically (see task b657c4c6).
 */
export const buildDirectTriggerInput = ({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  data,
  handler,
}: BuildDirectTriggerInputParams): BoundDirectTriggerInput => {
  const userMessage: CreateUserMessage = {
    projectId,
    conversationId,
    type: MessageType.User,
    parentMessageId: null,
    data: buildUserMessageData(data),
    ...(handler !== undefined ? { handler } : {}),
  };
  return {
    organizationId,
    projectId,
    agentSessionId,
    conversationId,
    intent: userMessage,
  };
};
