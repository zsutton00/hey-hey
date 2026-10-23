import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { resolvePromptModelSelection } from "../promptModelSelection";

const STORAGE_KEY = (surfaceId: string) =>
  `hey-hey:agent-selection:${surfaceId}`;

const storeCodingSetup = (value: {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: string | null;
  fastMode?: boolean;
}) => {
  localStorage.setItem(STORAGE_KEY("coding-setup"), JSON.stringify(value));
};

describe("resolvePromptModelSelection", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("prefers the persisted selection when it belongs to the active provider", () => {
    storeCodingSetup({
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });

    expect(
      resolvePromptModelSelection(ConversationStartRunRequestDtoProviderEnum.Claude, undefined, undefined)
    ).toEqual({
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      fastMode: false,
    });
  });

  it("ignores a persisted selection from a different provider and falls back to the prop", () => {
    storeCodingSetup({
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5-codex",
      reasoningEffort: "high",
    });

    expect(
      resolvePromptModelSelection(
        ConversationStartRunRequestDtoProviderEnum.Claude,
        "claude-sonnet-5-5",
        "low"
      )
    ).toEqual({
      model: "claude-sonnet-5-5",
      reasoningEffort: "low",
      fastMode: undefined,
    });
  });

  it("resolves a concrete model from the catalog default when nothing is stored or passed", () => {
    // Never returns an undefined model — otherwise the run dispatches with no
    // model and the server picks its own default.
    expect(
      resolvePromptModelSelection(ConversationStartRunRequestDtoProviderEnum.Claude, undefined, undefined)
    ).toEqual({
      model: "claude-opus-5-5",
      reasoningEffort: "medium",
      fastMode: false,
    });
  });

  it("falls back to the catalog when the stored model is no longer in the provider catalog", () => {
    storeCodingSetup({
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-removed-model",
      reasoningEffort: "high",
    });

    expect(
      resolvePromptModelSelection(ConversationStartRunRequestDtoProviderEnum.Claude, undefined, undefined)
    ).toEqual({
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      fastMode: false,
    });
  });

  it("preserves explicit Fast mode only for supported selections", () => {
    storeCodingSetup({
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    });

    expect(
      resolvePromptModelSelection(ConversationStartRunRequestDtoProviderEnum.Codex, undefined, undefined)
    ).toEqual({
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    });
  });
});
