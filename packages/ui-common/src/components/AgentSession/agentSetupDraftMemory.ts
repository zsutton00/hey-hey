import {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ProjectModeSelectionSchemaVersionEnum,
  type ProjectModeSelection,
} from "../../api";
import { SESSION_METHOD_REGISTRY } from "../../agents/coordination/sessionMethodRegistry";
import type { AgentSessionMethod } from "../../agents/prompts.js";
import type { AgentProvider, ReasoningEffort } from "./runtime/types";

const AGENT_SETUP_DRAFTS_VERSION = 2 as const;
export const AGENT_SETUP_DRAFT_LIMIT = 5 as const;

export interface AgentSetupDraft {
  version: typeof AGENT_SETUP_DRAFTS_VERSION;
  setupContextKey: string;
  sessionMethod: AgentSessionMethod | null;
  projectModeSelection: ProjectModeSelection | null;
  serviceIds: string[];
  launchServiceId: string | null;
  worktreeBranch: string | null;
  provider: AgentProvider;
  model: string;
  reasoningEffort: ReasoningEffort | null;
  lastEditedAt: string;
}

export type AgentSetupDraftInput = Omit<
  AgentSetupDraft,
  "version" | "lastEditedAt" | "projectModeSelection"
> & {
  projectModeSelection?: ProjectModeSelection | null;
};

interface AgentSetupDraftCollection {
  version: typeof AGENT_SETUP_DRAFTS_VERSION;
  drafts: AgentSetupDraft[];
}

const STORAGE_KEY_PREFIX = "hey-hey:agent-setup-drafts:";

export const buildAgentSetupDraftContextKey = (
  organizationId: string,
  projectId: string,
  agentSessionId: string,
): string => `${organizationId}:${projectId}:${agentSessionId}`;

export const getAgentSetupDraftStorageKey = (userId: string): string =>
  `${STORAGE_KEY_PREFIX}v${AGENT_SETUP_DRAFTS_VERSION}:${encodeURIComponent(
    userId,
  )}`;

const getStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const isAgentProvider = (value: unknown): value is AgentProvider =>
  typeof value === "string" &&
  Object.values(ConversationStartRunRequestDtoProviderEnum).some(
    (provider) => provider === value,
  );

const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === "string" &&
  Object.values(ConversationStartRunRequestDtoReasoningEffortEnum).some(
    (effort) => effort === value,
  );

const isAgentSessionMethod = (value: unknown): value is AgentSessionMethod =>
  value === "validation" ||
  (typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SESSION_METHOD_REGISTRY, value));

const isProjectModeSelection = (
  value: unknown,
): value is ProjectModeSelection => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion ===
      ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1 &&
    typeof candidate.modeId === "string" &&
    candidate.modeId.trim().length > 0
  );
};

const isDraft = (value: unknown): value is AgentSetupDraft => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === AGENT_SETUP_DRAFTS_VERSION &&
    typeof candidate.setupContextKey === "string" &&
    (isAgentSessionMethod(candidate.sessionMethod) ||
      candidate.sessionMethod === null) &&
    Array.isArray(candidate.serviceIds) &&
    candidate.serviceIds.every((id) => typeof id === "string") &&
    (candidate.launchServiceId === null ||
      typeof candidate.launchServiceId === "string") &&
    (candidate.worktreeBranch === null ||
      typeof candidate.worktreeBranch === "string") &&
    isAgentProvider(candidate.provider) &&
    typeof candidate.model === "string" &&
    (candidate.reasoningEffort === null ||
      isReasoningEffort(candidate.reasoningEffort)) &&
    typeof candidate.lastEditedAt === "string" &&
    (candidate.projectModeSelection === null ||
      isProjectModeSelection(candidate.projectModeSelection)) &&
    (candidate.sessionMethod === null) !==
      (candidate.projectModeSelection === null)
  );
};

const emptyCollection = (): AgentSetupDraftCollection => ({
  version: AGENT_SETUP_DRAFTS_VERSION,
  drafts: [],
});

const readCollection = (userId: string): AgentSetupDraftCollection => {
  const storage = getStorage();
  if (!storage || !userId) return emptyCollection();

  try {
    const raw = storage.getItem(getAgentSetupDraftStorageKey(userId));
    if (!raw) return emptyCollection();

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return emptyCollection();
    }

    const candidate = parsed as Record<string, unknown>;
    const drafts =
      candidate.version === AGENT_SETUP_DRAFTS_VERSION &&
      Array.isArray(candidate.drafts)
        ? candidate.drafts.filter(isDraft)
        : [];
    return { version: AGENT_SETUP_DRAFTS_VERSION, drafts };
  } catch {
    return emptyCollection();
  }
};

const writeCollection = (
  userId: string,
  drafts: readonly AgentSetupDraft[],
): void => {
  const storage = getStorage();
  if (!storage || !userId) return;

  const ordered = [...drafts]
    .sort((left, right) => right.lastEditedAt.localeCompare(left.lastEditedAt))
    .slice(0, AGENT_SETUP_DRAFT_LIMIT);
  try {
    storage.setItem(
      getAgentSetupDraftStorageKey(userId),
      JSON.stringify({ version: AGENT_SETUP_DRAFTS_VERSION, drafts: ordered }),
    );
  } catch {
    // Browser storage failures cannot affect launch behavior.
  }
};

export const readAgentSetupDraft = (
  userId: string | null,
  setupContextKey: string,
): AgentSetupDraft | null => {
  if (!userId) return null;
  return (
    readCollection(userId).drafts.find(
      (draft) => draft.setupContextKey === setupContextKey,
    ) ?? null
  );
};

export const upsertAgentSetupDraft = (
  userId: string | null,
  draft: AgentSetupDraftInput,
  now = new Date().toISOString(),
): void => {
  if (!userId) return;
  const collection = readCollection(userId);
  writeCollection(userId, [
    ...collection.drafts.filter(
      (candidate) => candidate.setupContextKey !== draft.setupContextKey,
    ),
    {
      ...draft,
      projectModeSelection: draft.projectModeSelection ?? null,
      version: AGENT_SETUP_DRAFTS_VERSION,
      lastEditedAt: now,
    },
  ]);
};

export const removeAgentSetupDraft = (
  userId: string | null,
  setupContextKey: string,
): void => {
  if (!userId) return;
  const collection = readCollection(userId);
  writeCollection(
    userId,
    collection.drafts.filter(
      (draft) => draft.setupContextKey !== setupContextKey,
    ),
  );
};
