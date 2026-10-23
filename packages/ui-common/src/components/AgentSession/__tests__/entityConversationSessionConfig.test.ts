import { describe, expect, it } from "vitest";
import {
  AgentSessionConfigEntityConversationV1EffortEnum,
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  type AgentSessionConfig,
} from "../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import {
  AgentSessionConfigEntityConversationV1TypeEnum as LocalAgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum as LocalAgentSessionConfigEntityConversationV1VersionEnum,
  type AgentSessionConfig as LocalAgentSessionConfig,
} from "../../../api";
import {
  readEntityConversationSessionConfig,
  resolveEntityConversationRuntimeSelection,
} from "../entityConversationSessionConfig";
import type { SurfaceSelection } from "../surfaceSelectionMemory";

const rememberedSelection: SurfaceSelection = {
  provider: ConversationStartRunRequestDtoProviderEnum.Codex,
  model: "remembered-model",
  reasoningEffort: "medium",
  fastMode: true,
};

describe("Entity Conversation durable session config", () => {
  it("is exposed by the CLI-facing generated config union", () => {
    const config = {
      type: LocalAgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
      version: LocalAgentSessionConfigEntityConversationV1VersionEnum.V1,
      model: "persisted-model",
    } satisfies LocalAgentSessionConfig;

    expect(config.type).toBe("ENTITY_CONVERSATION");
  });

  it("discriminates the Entity Conversation variant from coding config", () => {
    const codingConfig = {
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: AgentSessionConfigV2VersionEnum.V2,
      model: "coding-model",
    } satisfies AgentSessionConfig;

    expect(readEntityConversationSessionConfig(codingConfig)).toBeNull();
  });

  it("prefers persisted provider, model, and effort over remembered defaults", () => {
    const config = {
      type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
      version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
      model: "persisted-model",
      effort: AgentSessionConfigEntityConversationV1EffortEnum.High,
    } satisfies AgentSessionConfig;

    expect(
      resolveEntityConversationRuntimeSelection(
        { provider: ConversationStartRunRequestDtoProviderEnum.Claude, config },
        rememberedSelection,
      ),
    ).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "persisted-model",
      reasoningEffort: "high",
      fastMode: true,
    });
  });

  it("preserves omitted configured effort instead of reviving remembered effort", () => {
    const config = {
      type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
      version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
      model: "persisted-model",
    } satisfies AgentSessionConfig;

    expect(
      resolveEntityConversationRuntimeSelection(
        { provider: ConversationStartRunRequestDtoProviderEnum.Codex, config },
        rememberedSelection,
      )?.reasoningEffort,
    ).toBeNull();
  });

  it("uses the remembered selection only for legacy sessions without config", () => {
    expect(
      resolveEntityConversationRuntimeSelection(
        { provider: undefined, config: null },
        rememberedSelection,
      ),
    ).toEqual(rememberedSelection);
  });

  it("names no selection when neither the session nor memory names a provider and model", () => {
    expect(
      resolveEntityConversationRuntimeSelection(
        { provider: undefined, config: null },
        null,
      ),
    ).toBeNull();
  });

  it("completes a session's own provider and model without remembered selection", () => {
    const config = {
      type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
      version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
      model: "persisted-model",
    } satisfies AgentSessionConfig;

    expect(
      resolveEntityConversationRuntimeSelection(
        { provider: ConversationStartRunRequestDtoProviderEnum.Codex, config },
        null,
      ),
    ).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "persisted-model",
      reasoningEffort: null,
    });
  });
});
