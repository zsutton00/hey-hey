import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import {
  getOpencodeModelRef,
  installCapabilityCatalog,
  listEfforts,
  listModels,
  listProviders,
  parseRuntimeCapabilityCatalog,
  resetCapabilityCatalogForTests,
  setCapabilityCatalogForTests,
  supportsFastMode,
} from "../capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";

describe("capabilityCatalog", () => {
  beforeEach(() => {
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  afterEach(() => {
    resetCapabilityCatalogForTests();
  });

  describe("before a catalog is loaded", () => {
    it("offers nothing: there is no built-in list", () => {
      resetCapabilityCatalogForTests();
      expect(listProviders()).toEqual([]);
      expect(
        listModels(ConversationStartRunRequestDtoProviderEnum.Claude),
      ).toEqual([]);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Claude,
          "claude-opus-5-5",
        ),
      ).toBe(false);
    });
  });

  describe("installCapabilityCatalog", () => {
    it("installs a validated catalog, including a notice for a provider with zero models", () => {
      installCapabilityCatalog([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          models: [],
          notice: "Claude reported zero models on this machine.",
        },
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
          models: [{ id: "opencode-default", label: "Default", efforts: [] }],
        },
      ]);
      expect(listProviders()).toEqual([
        ConversationStartRunRequestDtoProviderEnum.Claude,
        ConversationStartRunRequestDtoProviderEnum.Opencode,
      ]);
      expect(
        listModels(ConversationStartRunRequestDtoProviderEnum.Claude),
      ).toEqual([]);
    });

    it("rejects a provider row with no models and no notice, or a notice beside models", () => {
      expect(() =>
        installCapabilityCatalog([
          {
            provider: ConversationStartRunRequestDtoProviderEnum.Claude,
            models: [],
          },
        ]),
      ).toThrow("notice explaining why");
      expect(() =>
        installCapabilityCatalog([
          {
            provider: ConversationStartRunRequestDtoProviderEnum.Claude,
            models: [{ id: "m", label: "M", efforts: [] }],
            notice: "Not allowed beside models.",
          },
        ]),
      ).toThrow("notice explaining why");
    });

    it("names the provider and model when an effort is not launchable", () => {
      expect(() =>
        installCapabilityCatalog([
          {
            provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
            models: [{ id: "p/m", label: "M", efforts: ["turbo"] }],
          },
        ]),
      ).toThrow(
        'Catalog opencode model "p/m": Catalog model effort "turbo" is not a launchable reasoning effort.',
      );
    });

    it("accepts the provider-specific effort ids the launch contract carries", () => {
      installCapabilityCatalog([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          models: [
            {
              id: "m",
              label: "M",
              efforts: ["none", "minimal", "medium", "ultra", "default"],
            },
          ],
        },
      ]);
      expect(
        listEfforts(ConversationStartRunRequestDtoProviderEnum.Codex, "m"),
      ).toEqual(["none", "minimal", "medium", "ultra", "default"]);
    });
  });

  describe("listProviders", () => {
    it("returns every catalog provider in declared order", () => {
      const providers = listProviders();
      expect(providers).toEqual(
        TEST_CAPABILITY_CATALOG.map((row) => row.provider),
      );
      expect(providers).toEqual([
        ConversationStartRunRequestDtoProviderEnum.Claude,
        ConversationStartRunRequestDtoProviderEnum.Codex,
        ConversationStartRunRequestDtoProviderEnum.Opencode,
      ]);
    });
  });

  describe("listModels", () => {
    it("returns the model rows for a known provider in declared order", () => {
      const models = listModels(
        ConversationStartRunRequestDtoProviderEnum.Claude,
      );
      expect(models.map((model) => model.id)).toEqual([
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-opus-5",
        "claude-fable-5-1",
        "claude-fable-5",
        "claude-haiku-5-5",
      ]);
    });

    it("returns an empty array for an unknown provider", () => {
      const models = listModels(
        "not-a-provider" as ConversationStartRunRequestDtoProviderEnum,
      );
      expect(models).toEqual([]);
    });
  });

  describe("listEfforts", () => {
    it("returns the declared effort list for a known model", () => {
      const efforts = listEfforts(
        ConversationStartRunRequestDtoProviderEnum.Claude,
        "claude-opus-5-5",
      );
      expect(efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    });

    it("returns an empty array when a model declares no efforts", () => {
      const efforts = listEfforts(
        ConversationStartRunRequestDtoProviderEnum.Opencode,
        "opencode-default",
      );
      expect(efforts).toEqual([]);
    });

    it("returns an empty array for an unknown model under a known provider", () => {
      const efforts = listEfforts(
        ConversationStartRunRequestDtoProviderEnum.Claude,
        "no-such-model",
      );
      expect(efforts).toEqual([]);
    });

    it("returns an empty array for an unknown provider", () => {
      const efforts = listEfforts(
        "not-a-provider" as ConversationStartRunRequestDtoProviderEnum,
        "claude-opus-5-5",
      );
      expect(efforts).toEqual([]);
    });
  });

  describe("getOpencodeModelRef", () => {
    it("returns null for the default OpenCode row (no provider/model pair declared)", () => {
      expect(getOpencodeModelRef("opencode-default")).toBeNull();
    });

    it("returns null for a model id that is not in the OpenCode row", () => {
      expect(getOpencodeModelRef("claude-opus-5-5")).toBeNull();
    });

    it("returns the providerID/modelID pair for GLM-5.3", () => {
      expect(getOpencodeModelRef("glm-5.3")).toEqual({
        providerID: "opencode-go",
        modelID: "glm-5.3",
      });
    });
  });

  describe("supportsFastMode", () => {
    it("is enabled only for catalog rows advertising the priority service tier", () => {
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Codex,
          "gpt-5.4",
        ),
      ).toBe(false);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Codex,
          "gpt-5.5",
        ),
      ).toBe(false);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Codex,
          "gpt-5.6-sol",
        ),
      ).toBe(true);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Codex,
          "gpt-5.6-luna",
        ),
      ).toBe(true);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Codex,
          "gpt-5.6-terra",
        ),
      ).toBe(true);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Codex,
          "gpt-6-sol",
        ),
      ).toBe(true);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Claude,
          "claude-opus-5-5",
        ),
      ).toBe(true);
      expect(
        supportsFastMode(
          ConversationStartRunRequestDtoProviderEnum.Claude,
          "claude-opus-5",
        ),
      ).toBe(true);
      for (const model of [
        "claude-sonnet-5-5",
        "claude-fable-5-1",
        "claude-haiku-5-5",
      ]) {
        expect(
          supportsFastMode(
            ConversationStartRunRequestDtoProviderEnum.Claude,
            model,
          ),
        ).toBe(false);
      }
    });
  });

  describe("parseRuntimeCapabilityCatalog", () => {
    const codexModel = (extra: Record<string, unknown>) => ({
      providers: [
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          models: [
            { id: "model", label: "Model", efforts: ["medium"], ...extra },
          ],
        },
      ],
    });

    it("accepts a catalog read from a CLI, including Claude service tiers", () => {
      const payload = {
        providers: [
          {
            provider: ConversationStartRunRequestDtoProviderEnum.Claude,
            models: [
              {
                id: "claude-runtime",
                label: "Claude Runtime",
                efforts: ["medium"],
                serviceTiers: ["priority"],
              },
            ],
          },
        ],
      };
      expect(parseRuntimeCapabilityCatalog(payload)).toEqual(payload);
    });

    it("rejects a catalog effort the launch contract does not carry", () => {
      expect(() =>
        parseRuntimeCapabilityCatalog(
          codexModel({ efforts: ["medium", "turbo"] }),
        ),
      ).toThrow('Catalog codex model "model": Catalog model effort "turbo"');
    });

    it("rejects service tier metadata the provider cannot carry", () => {
      expect(() =>
        parseRuntimeCapabilityCatalog({
          providers: [
            {
              provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
              models: [
                {
                  id: "o",
                  label: "O",
                  efforts: ["medium"],
                  serviceTiers: ["priority"],
                },
              ],
            },
          ],
        }),
      ).toThrow("unsupported metadata");
    });

    it("rejects a payload without a providers array", () => {
      expect(() => parseRuntimeCapabilityCatalog({})).toThrow(
        "providers array",
      );
    });
  });
});
