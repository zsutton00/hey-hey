import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionDtoProviderEnum,
  type AgentSessionDto,
} from "../../../api";
import { describe, expect, it } from "vitest";
import { resolveAgentSessionMetadata } from "../resolveAgentSessionMetadata";

const sessionWithConfig = (
  config: NonNullable<AgentSessionDto["config"]>,
  provider: AgentSessionDtoProviderEnum = AgentSessionDtoProviderEnum.Codex
) =>
  ({
    config,
    provider,
  }) satisfies Pick<AgentSessionDto, "config" | "provider">;

describe("resolveAgentSessionMetadata", () => {
  it("resolves only selected canonical names in selection order and omits unavailable names", () => {
    const session = {
      ...sessionWithConfig({
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: "gpt-5-codex",
        worktree: " feature/metadata ",
      }),
      serviceIds: ["web", "missing", "api", "blank", "web"],
    };
    const services = [
      { id: "api", name: "API" },
      { id: "web", name: "Web UI" },
      { id: "blank", name: " " },
      { id: "unselected", name: "Other" },
    ];
    expect(resolveAgentSessionMetadata(session, services)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      worktree: "feature/metadata",
      serviceNames: ["Web UI", "API"],
    });
    expect(resolveAgentSessionMetadata(session)).not.toHaveProperty("serviceNames");
    expect(resolveAgentSessionMetadata({ ...session, serviceIds: [] }, services))
      .not.toHaveProperty("serviceNames");
  });

  it("projects the durable provider, trimmed model, and effort", () => {
    const session = sessionWithConfig({
      type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
      version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
      model: "  gpt-5-codex  ",
      effort: "high",
    });

    expect(resolveAgentSessionMetadata(session)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      effort: "high",
    });
  });

  it("omits metadata when the durable config or provider is absent", () => {
    expect(resolveAgentSessionMetadata({ config: null })).toBeUndefined();
    expect(
      resolveAgentSessionMetadata({
        config: {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: "gpt-5-codex",
        },
      })
    ).toBeUndefined();
    expect(
      resolveAgentSessionMetadata({
        provider: AgentSessionDtoProviderEnum.Codex,
        config: {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: "   ",
        },
      })
    ).toBeUndefined();
  });

  it("does not synthesize effort when the durable config omits it", () => {
    const session = sessionWithConfig({
      type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
      version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
      model: "gpt-5-codex",
    });

    expect(resolveAgentSessionMetadata(session)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
    });
  });

  it("projects enabled Codex Fast mode", () => {
    const session = sessionWithConfig({
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: AgentSessionConfigV2VersionEnum.V2,
      model: "gpt-5-codex",
      fastMode: true,
    });

    expect(resolveAgentSessionMetadata(session)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      fastMode: true,
    });
  });

  it("projects enabled Claude Fast mode", () => {
    const session = sessionWithConfig(
      {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: "claude-opus-5-5",
        fastMode: true,
      },
      AgentSessionDtoProviderEnum.Claude
    );

    expect(resolveAgentSessionMetadata(session)).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      fastMode: true,
    });
  });

  it("omits disabled Fast mode", () => {
    const disabled = sessionWithConfig({
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: AgentSessionConfigV2VersionEnum.V2,
      model: "gpt-5-codex",
      fastMode: false,
    });
    const claude = sessionWithConfig(
      {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: "claude-opus-5-5",
        fastMode: false,
      },
      AgentSessionDtoProviderEnum.Claude
    );

    expect(resolveAgentSessionMetadata(disabled)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
    });
    expect(resolveAgentSessionMetadata(claude)).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
    });
  });

  it("projects and trims the durable coding-session worktree", () => {
    const session = sessionWithConfig({
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: AgentSessionConfigV2VersionEnum.V2,
      model: "gpt-5-codex",
      worktree: " feature/current-worktree ",
    });

    expect(resolveAgentSessionMetadata(session)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      worktree: "feature/current-worktree",
    });
  });

  it("omits an empty durable coding-session worktree", () => {
    const session = sessionWithConfig({
      type: AgentSessionConfigV2TypeEnum.CodingSession,
      version: AgentSessionConfigV2VersionEnum.V2,
      model: "gpt-5-codex",
      worktree: "   ",
    });

    expect(resolveAgentSessionMetadata(session)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
    });
  });
});
