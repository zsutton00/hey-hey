import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionDtoProviderEnum,
  AgentSessionServicePlaceKind,
  type AgentSessionDto,
} from "../../../api";
import { describe, expect, it } from "vitest";
import { resolveAgentSessionMetadata } from "../resolveAgentSessionMetadata";

const sessionWithConfig = (
  config: NonNullable<AgentSessionDto["config"]>,
  provider: AgentSessionDtoProviderEnum = AgentSessionDtoProviderEnum.Codex,
) =>
  ({
    config,
    provider,
  }) satisfies Pick<AgentSessionDto, "config" | "provider">;

describe("resolveAgentSessionMetadata", () => {
  it("resolves one place per selected Service with a known name, never reading config.worktree", () => {
    const recordedAt = "2026-11-19T00:00:00.000Z";
    const session = {
      ...sessionWithConfig({
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: "gpt-5-codex",
        worktree: "feature/from-config",
      }),
      serviceIds: ["web", "missing", "api", "blank", "web", "docs", "demos"],
      servicePlaces: [
        {
          serviceId: "web",
          kind: AgentSessionServicePlaceKind.Worktree,
          branch: "feature-x",
          worktreePath: "/w/web",
          recordedAt,
        },
        {
          serviceId: "api",
          kind: AgentSessionServicePlaceKind.MainFolder,
          branch: "dev",
          recordedAt,
        },
        {
          serviceId: "docs",
          kind: AgentSessionServicePlaceKind.MainFolder,
          branch: null,
          recordedAt,
        },
      ],
    };
    const services = [
      { id: "api", name: "API" },
      { id: "web", name: "Web UI" },
      { id: "blank", name: " " },
      { id: "docs", name: "Docs" },
      { id: "demos", name: "Demos" },
      { id: "unselected", name: "Other" },
    ];
    const resolved = resolveAgentSessionMetadata(session, services);

    expect(resolved).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      servicePlaces: [
        {
          serviceName: "Web UI",
          place: { kind: "worktree", branch: "feature-x" },
        },
        { serviceName: "API", place: { kind: "main-folder", branch: "dev" } },
        { serviceName: "Docs", place: { kind: "main-folder", branch: null } },
        { serviceName: "Demos", place: { kind: "not-recorded" } },
      ],
    });
    expect(resolved).not.toHaveProperty("worktree");
    expect(resolveAgentSessionMetadata(session)).not.toHaveProperty(
      "servicePlaces",
    );
    expect(
      resolveAgentSessionMetadata({ ...session, serviceIds: [] }, services),
    ).not.toHaveProperty("servicePlaces");
  });

  it("shows Not recorded for sessions without place records even when config.worktree is set", () => {
    const session = {
      ...sessionWithConfig({
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: "gpt-5-codex",
        worktree: "legacy-branch",
      }),
      serviceIds: ["api"],
      servicePlaces: [],
    };

    expect(
      resolveAgentSessionMetadata(session, [{ id: "api", name: "API" }]),
    ).toMatchObject({
      servicePlaces: [{ serviceName: "API", place: { kind: "not-recorded" } }],
    });
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
      }),
    ).toBeUndefined();
    expect(
      resolveAgentSessionMetadata({
        provider: AgentSessionDtoProviderEnum.Codex,
        config: {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: "   ",
        },
      }),
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
      AgentSessionDtoProviderEnum.Claude,
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
      AgentSessionDtoProviderEnum.Claude,
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
});
