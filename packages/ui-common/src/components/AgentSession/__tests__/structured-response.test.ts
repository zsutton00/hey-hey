import { describe, expect, it } from "vitest";
import {
  extractStructuredJsonPayload,
  parseStructuredResponseFromText,
  readStructuredResponseContract,
} from "../structured-response.js";

describe("structured-response", () => {
  it("extracts payload from fenced json blocks", () => {
    expect(
      extractStructuredJsonPayload(
        'Result:\n```json\n{"responseType":"startup_plan_v1"}\n```'
      )
    ).toBe('{"responseType":"startup_plan_v1"}');
  });

  it("extracts payload from first and last braces when no fence exists", () => {
    expect(extractStructuredJsonPayload('before {"a":1} after')).toBe(
      '{"a":1}'
    );
  });

  it("returns null when parsed payload is not an object", () => {
    expect(parseStructuredResponseFromText("[1,2,3]")).toBeNull();
  });

  it("reads legacy responseType contracts", () => {
    expect(
      readStructuredResponseContract({ responseType: "startup_plan_v1" })
    ).toEqual({
      type: "startup_plan",
      version: 1,
    });
  });

  it("reads explicit type/version contracts", () => {
    expect(
      readStructuredResponseContract({ type: "startup_plan", version: 1 })
    ).toEqual({
      type: "startup_plan",
      version: 1,
    });
  });

  it("parses object payload and resolves contract when present", () => {
    expect(
      parseStructuredResponseFromText(
        '{"type":"startup_plan","version":1,"executionPlan":[],"discrepancies":[],"clarificationQuestions":[]}'
      )
    ).toEqual({
      value: {
        type: "startup_plan",
        version: 1,
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
      contract: {
        type: "startup_plan",
        version: 1,
      },
    });
  });
});
