import { describe, it, expect, beforeEach } from "vitest";
import {
  loadConfig,
  getRelatedEntities,
  resetConfig,
  getLoadedConfig,
  validateConfig,
  type InvalidationConfig,
} from "../relationships/config";

function makeValidConfig(
  overrides?: Partial<InvalidationConfig>
): InvalidationConfig {
  return {
    version: "1.0.0",
    generatedAt: "2026-04-13T00:00:00.000Z",
    rules: [
      {
        sourceEntity: "Service",
        sourceFields: ["id", "name"],
        targetCollections: ["CodingSession"],
        relationshipPath: "service",
        cardinality: "1:many",
        lookupField: "serviceId",
        invalidationMode: "invalidate",
      },
      {
        sourceEntity: "Task",
        sourceFields: ["id", "status"],
        targetCollections: ["Plan", "Initiative"],
        relationshipPath: "tasks",
        cardinality: "1:many",
        lookupField: "taskId",
        invalidationMode: "cascade",
      },
    ],
    ...overrides,
  };
}

describe("validateConfig", () => {
  it("accepts a well-formed config", () => {
    const config = makeValidConfig();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects non-object config", () => {
    expect(() => validateConfig("not an object")).toThrow("must be an object");
    expect(() => validateConfig(null)).toThrow("must be an object");
  });

  it("rejects config missing version", () => {
    expect(() => validateConfig({ generatedAt: "x", rules: [] })).toThrow(
      "version"
    );
  });

  it("rejects config missing generatedAt", () => {
    expect(() => validateConfig({ version: "1", rules: [] })).toThrow(
      "generatedAt"
    );
  });

  it("rejects config missing rules array", () => {
    expect(() => validateConfig({ version: "1", generatedAt: "x" })).toThrow(
      "rules"
    );
  });

  it("rejects rule with missing sourceEntity", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).sourceEntity = "";
    expect(() => validateConfig(config)).toThrow(
      "sourceEntity must be a non-empty string"
    );
  });

  it("rejects rule with empty sourceFields", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).sourceFields = [];
    expect(() => validateConfig(config)).toThrow(
      "sourceFields must be a non-empty array"
    );
  });

  it("rejects rule with invalid cardinality", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).cardinality = "many:many";
    expect(() => validateConfig(config)).toThrow("cardinality");
  });

  it("rejects rule with invalid invalidationMode", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).invalidationMode = "reload";
    expect(() => validateConfig(config)).toThrow("invalidationMode");
  });

  it("rejects rule with malformed dataVariantKey", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).dataVariantKey = {
      queryParam: "",
    };
    expect(() => validateConfig(config)).toThrow(
      "dataVariantKey.queryParam must be a non-empty string"
    );
  });

  it("accepts rule with valid dataVariantKey", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).dataVariantKey = {
      queryParam: "includeDetails",
      requiredValue: "true",
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects non-object rule", () => {
    expect(() =>
      validateConfig({ version: "1", generatedAt: "x", rules: ["bad"] })
    ).toThrow("Rule at index 0 is not an object");
  });

  it("rejects rule with unknown keys", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).extraField = "oops";
    expect(() => validateConfig(config)).toThrow("unknown keys: extraField");
  });

  it("rejects empty string in sourceFields array", () => {
    const config = makeValidConfig();
    (config.rules[0] as Record<string, unknown>).sourceFields = ["id", ""];
    expect(() => validateConfig(config)).toThrow(
      "sourceFields[1] must be a non-empty string"
    );
  });
});

describe("configLoader", () => {
  beforeEach(() => {
    resetConfig();
  });

  describe("loadConfig", () => {
    it("loads and caches a valid config", () => {
      const config = makeValidConfig();
      loadConfig(config);
      expect(getLoadedConfig()).not.toBeNull();
      expect(getLoadedConfig()!.version).toBe("1.0.0");
    });

    it("throws on invalid config", () => {
      expect(() => loadConfig({ bad: true })).toThrow();
    });
  });

  describe("getRelatedEntities", () => {
    it("throws if config not loaded", () => {
      expect(() => getRelatedEntities("Service", "update")).toThrow(
        "config has not been loaded"
      );
    });

    it("returns empty array for unknown entity type", () => {
      loadConfig(makeValidConfig());
      const result = getRelatedEntities("Unknown", "update");
      expect(result).toEqual([]);
    });

    it("returns patterns for a known entity type", () => {
      loadConfig(makeValidConfig());
      const result = getRelatedEntities("Service", "update");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        collection: "CodingSession",
        invalidationMode: "invalidate",
        relationshipPath: "service",
        lookupField: "serviceId",
        cardinality: "1:many",
        sourceFields: ["id", "name"],
        dataVariantKey: undefined,
      });
    });

    it("expands targetCollections into separate patterns", () => {
      loadConfig(makeValidConfig());
      const result = getRelatedEntities("Task", "update");
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.collection)).toEqual(["Plan", "Initiative"]);
    });

    it("returns patterns for all operations on the same entity type", () => {
      loadConfig(makeValidConfig());
      const create = getRelatedEntities("Service", "create");
      const update = getRelatedEntities("Service", "update");
      const del = getRelatedEntities("Service", "delete");
      expect(create).toEqual(update);
      expect(update).toEqual(del);
    });
  });

  describe("resetConfig", () => {
    it("clears loaded config", () => {
      loadConfig(makeValidConfig());
      expect(getLoadedConfig()).not.toBeNull();
      resetConfig();
      expect(getLoadedConfig()).toBeNull();
    });
  });
});
