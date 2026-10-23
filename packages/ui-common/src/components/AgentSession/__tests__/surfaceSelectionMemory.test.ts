import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import {
  buildDefaultSurfaceSelection,
  readSurfaceSelection,
  SERVICE_IMPORT_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../surfaceSelectionMemory";
import {
  installCapabilityCatalog,
  listEfforts,
  listModels,
  listProviders,
  resetCapabilityCatalogForTests,
} from "../capabilityCatalog";

const STORAGE_KEY = (surfaceId: string) =>
  `hey-hey:agent-selection:${surfaceId}`;

const VALID_CLAUDE: SurfaceSelection = {
  provider: ConversationStartRunRequestDtoProviderEnum.Claude,
  model: "claude-opus-5-5",
  reasoningEffort: "high",
  fastMode: false,
};

const VALID_OPENCODE: SurfaceSelection = {
  provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
  model: "opencode-default",
  reasoningEffort: null,
  fastMode: false,
};

describe("surfaceSelectionMemory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readSurfaceSelection", () => {
    it("exposes the shared Service Import surface id", () => {
      expect(SERVICE_IMPORT_SURFACE_ID).toBe("service-import");
    });

    it("returns the previously written triple for a real provider/model/effort", () => {
      writeSurfaceSelection("coding-setup", VALID_CLAUDE);
      expect(readSurfaceSelection("coding-setup")).toEqual(VALID_CLAUDE);
    });

    it("returns null when nothing has been written for the surface", () => {
      expect(readSurfaceSelection("coding-setup")).toBeNull();
    });

    it("returns null when the provider is not in the catalog", () => {
      localStorage.setItem(
        STORAGE_KEY("discuss"),
        JSON.stringify({
          provider: "not-a-provider",
          model: "claude-opus-5-5",
          reasoningEffort: "high",
        }),
      );
      expect(readSurfaceSelection("discuss")).toBeNull();
    });

    it.each([
      "gpt-5.6-sol",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
    ])("reconciles stale model %s to the provider default", (model) => {
      localStorage.setItem(
        STORAGE_KEY("discuss"),
        JSON.stringify({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model,
          reasoningEffort: "high",
        }),
      );
      const fallbackModel = listModels(
        ConversationStartRunRequestDtoProviderEnum.Claude,
      )[0];
      const fallbackEfforts = listEfforts(
        ConversationStartRunRequestDtoProviderEnum.Claude,
        fallbackModel.id,
      );
      expect(readSurfaceSelection("discuss")).toEqual({
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: fallbackModel.id,
        reasoningEffort: fallbackEfforts.includes("high")
          ? "high"
          : fallbackEfforts.includes("medium")
            ? "medium"
            : (fallbackEfforts[0] ?? null),
      });
    });

    it.each([
      { storedEffort: "retired-effort", expectedEffort: "medium" },
      { storedEffort: "max", expectedEffort: "max" },
    ])(
      "reconciles stored effort $storedEffort to $expectedEffort",
      ({ storedEffort, expectedEffort }) => {
        localStorage.setItem(
          STORAGE_KEY("discuss"),
          JSON.stringify({
            provider: ConversationStartRunRequestDtoProviderEnum.Claude,
            model: "claude-sonnet-5-5",
            reasoningEffort: storedEffort,
          }),
        );
        expect(readSurfaceSelection("discuss")).toEqual({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-sonnet-5-5",
          reasoningEffort: expectedEffort,
        });
      },
    );

    it("does not reject remembered effort strings before catalog reconciliation", () => {
      localStorage.setItem(
        STORAGE_KEY("discuss"),
        JSON.stringify({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
          reasoningEffort: "experimental-runtime-effort",
        }),
      );
      expect(readSurfaceSelection("discuss")).toEqual({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
      });
    });

    it("returns null when the stored payload is malformed JSON", () => {
      localStorage.setItem(STORAGE_KEY("plan-approval"), "{not-json");
      expect(readSurfaceSelection("plan-approval")).toBeNull();
    });

    it("returns null when the stored payload is not an object", () => {
      localStorage.setItem(STORAGE_KEY("plan-approval"), JSON.stringify(42));
      expect(readSurfaceSelection("plan-approval")).toBeNull();
    });

    it("accepts and round-trips a null effort for a model with an empty effort list", () => {
      writeSurfaceSelection("coding-setup", VALID_OPENCODE);
      expect(readSurfaceSelection("coding-setup")).toEqual(VALID_OPENCODE);
    });

    it("reconciles to null effort when the model declares no efforts", () => {
      localStorage.setItem(
        STORAGE_KEY("coding-setup"),
        JSON.stringify({
          provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
          model: "opencode-default",
          reasoningEffort: "high",
        }),
      );
      expect(readSurfaceSelection("coding-setup")).toEqual({
        provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
        model: "opencode-default",
        reasoningEffort: null,
      });
    });

    it("isolates selections by surface id", () => {
      writeSurfaceSelection("coding-setup", VALID_CLAUDE);
      writeSurfaceSelection("discuss", VALID_OPENCODE);
      expect(readSurfaceSelection("coding-setup")).toEqual(VALID_CLAUDE);
      expect(readSurfaceSelection("discuss")).toEqual(VALID_OPENCODE);
      expect(readSurfaceSelection("plan-approval")).toBeNull();
    });

    it("returns null when localStorage.getItem throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      expect(readSurfaceSelection("coding-setup")).toBeNull();
    });
  });

  describe("buildDefaultSurfaceSelection", () => {
    it("is null until the CLI's catalog has loaded: nothing is preselected", () => {
      resetCapabilityCatalogForTests();
      expect(buildDefaultSurfaceSelection()).toBeNull();
    });

    it("skips a provider that reported zero models", () => {
      installCapabilityCatalog([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          models: [],
          notice: "Claude reported zero models.",
        },
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          models: [{ id: "cli-gpt", label: "CLI GPT", efforts: ["low"] }],
        },
      ]);
      expect(buildDefaultSurfaceSelection()).toEqual({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "cli-gpt",
        reasoningEffort: "low",
      });
    });

    it("derives the first provider / model / effort from the catalog", () => {
      const provider = listProviders()[0];
      const model = listModels(provider)[0];
      const efforts = listEfforts(provider, model.id);
      expect(buildDefaultSurfaceSelection()).toEqual({
        provider,
        model: model.id,
        reasoningEffort: efforts.includes("medium")
          ? "medium"
          : (efforts[0] ?? null),
      });
    });

    it("produces a selection that survives validation on read", () => {
      const selection = buildDefaultSurfaceSelection();
      expect(selection).not.toBeNull();
      writeSurfaceSelection("task-refiner", selection as SurfaceSelection);
      expect(readSurfaceSelection("task-refiner")).toEqual(selection);
    });
  });

  describe("writeSurfaceSelection", () => {
    it("round-trips through localStorage", () => {
      writeSurfaceSelection("plan-approval", VALID_CLAUDE);
      const stored = localStorage.getItem(STORAGE_KEY("plan-approval"));
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored as string)).toEqual(VALID_CLAUDE);
    });

    it("overwrites an existing selection on the same surface", () => {
      writeSurfaceSelection("coding-setup", VALID_CLAUDE);
      const next: SurfaceSelection = {
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        fastMode: false,
      };
      writeSurfaceSelection("coding-setup", next);
      expect(readSurfaceSelection("coding-setup")).toEqual(next);
    });

    it("round-trips Fast mode for a supported model", () => {
      const selection: SurfaceSelection = {
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        fastMode: true,
      };
      writeSurfaceSelection("coding-setup", selection);
      expect(readSurfaceSelection("coding-setup")).toEqual(selection);
    });

    it("silently no-ops when localStorage.setItem throws", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      expect(() =>
        writeSurfaceSelection("coding-setup", VALID_CLAUDE),
      ).not.toThrow();
    });
  });

  describe("missing localStorage (SSR)", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );

    afterEach(() => {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      }
    });

    it("read returns null when localStorage is undefined", () => {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => undefined,
      });
      expect(readSurfaceSelection("coding-setup")).toBeNull();
    });

    it("write does not throw when localStorage is undefined", () => {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => undefined,
      });
      expect(() =>
        writeSurfaceSelection("coding-setup", VALID_CLAUDE),
      ).not.toThrow();
    });

    it("read returns null when accessing localStorage throws", () => {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
          throw new Error("forbidden");
        },
      });
      expect(readSurfaceSelection("coding-setup")).toBeNull();
    });
  });
});
