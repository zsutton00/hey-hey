import type {
  AgentSkillSelection,
  RunAttachmentReference,
  StagedBrowserTabReference,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../api";
import type { ReasoningEffort } from "../AgentSession/runtime/types";
import type { AgentSessionConfigEntityConversationV1 } from "../../api/api";

export type EntityConversationProjectAssistantConfig = NonNullable<
  AgentSessionConfigEntityConversationV1["projectAssistant"]
>;

export interface GraphConversationLaunchInput {
  prompt: string;
  /** Uploaded files delivered with the first message; empty when none. */
  attachments?: RunAttachmentReference[];
  /** The Shared Browser tab opened before the session, which it takes over; null when none. */
  stagedBrowserTab?: StagedBrowserTabReference | null;
  skillSelection?: AgentSkillSelection;
  provider: ConversationStartRunRequestDtoProviderEnum;
  model?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  machineId: string;
  /** Optional repository-bound Service context; omitted for graph-only mode. */
  serviceId?: string;
  fastMode?: boolean;
  projectAssistant?: EntityConversationProjectAssistantConfig;
  disableCodexSystemPrompt?: boolean;
}
