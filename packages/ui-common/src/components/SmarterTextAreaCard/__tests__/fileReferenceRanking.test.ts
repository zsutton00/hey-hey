import { describe, expect, it } from "vitest";
import { rankFileReferenceCandidates } from "../fileReferences/fileReferenceRanking";

const candidates = [
  {
    serviceId: "service-b",
    serviceName: "UI Common",
    normalizedPath: "src/components/FileReferencePopup.tsx",
  },
  {
    serviceId: "service-a",
    serviceName: "API",
    normalizedPath: "src/files/reference.service.ts",
  },
  {
    serviceId: "service-c",
    serviceName: "CLI",
    normalizedPath: "tests/file_reference_plugin.test.ts",
  },
];

describe("rankFileReferenceCandidates", () => {
  it("returns the complete empty-query set in deterministic path order", () => {
    expect(
      rankFileReferenceCandidates([...candidates].reverse(), "").map(
        ({ normalizedPath }) => normalizedPath
      )
    ).toEqual([
      "src/components/FileReferencePopup.tsx",
      "src/files/reference.service.ts",
      "tests/file_reference_plugin.test.ts",
    ]);
  });

  it("normalizes case and slash direction and prioritizes exact basenames", () => {
    expect(
      rankFileReferenceCandidates(candidates, "FILEREFERENCEPOPUP.TSX")[0]
        ?.normalizedPath
    ).toBe("src/components/FileReferencePopup.tsx");
    expect(
      rankFileReferenceCandidates(candidates, "src\\files\\reference.service.ts")[0]
        ?.normalizedPath
    ).toBe("src/files/reference.service.ts");
  });

  it("supports ordered tokens and bounded transposition matching", () => {
    expect(
      rankFileReferenceCandidates(candidates, "file popup")[0]?.normalizedPath
    ).toBe("src/components/FileReferencePopup.tsx");
    expect(
      rankFileReferenceCandidates(candidates, "servcie")[0]?.normalizedPath
    ).toBe("src/files/reference.service.ts");
  });

  it("does not fuzzy-match very short tokens", () => {
    expect(rankFileReferenceCandidates(candidates, "fx")).toEqual([]);
  });
});
