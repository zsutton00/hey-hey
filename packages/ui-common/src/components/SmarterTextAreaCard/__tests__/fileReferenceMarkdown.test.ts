import { describe, expect, it } from "vitest";
import {
  fileReferenceDestination,
  parseFileReferenceMarkdownParts,
  serializeFileReferenceMarkdown,
} from "../fileReferences/fileReferenceMarkdown";

const value = {
  version: 1 as const,
  serviceId: "service-1",
  serviceName: "UI Common",
  normalizedPath: "src/components/File Reference.tsx",
};

describe("file reference Markdown", () => {
  it("stores stable identity and a percent-encoded path in a readable link", () => {
    expect(serializeFileReferenceMarkdown(value)).toBe(
      "[$UI Common/src/components/File Reference.tsx](heyhey-file:v1:service-1:src%2Fcomponents%2FFile%20Reference.tsx)"
    );
  });

  it("reconstructs the complete typed value from destination and label", () => {
    expect(
      parseFileReferenceMarkdownParts(
        "$UI Common/src/components/File Reference.tsx",
        fileReferenceDestination(value)
      )
    ).toEqual(value);
  });

  it("leaves unsupported versions and mismatched labels unclaimed", () => {
    expect(
      parseFileReferenceMarkdownParts(
        "$UI Common/other.ts",
        fileReferenceDestination(value)
      )
    ).toBeNull();
    expect(
      parseFileReferenceMarkdownParts(
        "$UI Common/src/components/File Reference.tsx",
        "heyhey-file:v2:service-1:path"
      )
    ).toBeNull();
  });
});
