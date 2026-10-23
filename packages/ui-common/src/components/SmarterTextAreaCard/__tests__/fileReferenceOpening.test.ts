import { describe, expect, it } from "vitest";
import type { ServiceRepoBinding } from "../../../api";
import { resolveFileReferenceSource } from "../fileReferences/fileReferenceOpening";
import type { FileReferenceValueV1 } from "../fileReferences/types";

const value = (normalizedPath: string): FileReferenceValueV1 => ({
  version: 1,
  serviceId: "service-1",
  serviceName: "UI Common",
  normalizedPath,
});

const binding = (repositoryPath: string): ServiceRepoBinding => ({
  serviceId: "service-1",
  repositoryPath,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T01:00:00.000Z",
});

describe("resolveFileReferenceSource", () => {
  it.each([
    ["/work/ui-common", "/work/ui-common/src/components/Editor.tsx"],
    ["/work/ui-common/", "/work/ui-common/src/components/Editor.tsx"],
    ["/", "/src/components/Editor.tsx"],
  ])("safely joins a POSIX root %s", (repositoryPath, expectedPath) => {
    expect(
      resolveFileReferenceSource(value("src/components/Editor.tsx"), {
        "service-1": binding(repositoryPath),
      })
    ).toEqual({ path: expectedPath, line: 1, column: 1 });
  });

  it.each([
    ["C:\\work\\ui-common", "C:\\work\\ui-common\\src\\Editor.tsx"],
    ["c:\\work\\ui-common\\", "C:\\work\\ui-common\\src\\Editor.tsx"],
    ["D:\\", "D:\\src\\Editor.tsx"],
  ])("safely joins a Windows root %s", (repositoryPath, expectedPath) => {
    expect(
      resolveFileReferenceSource(value("src/Editor.tsx"), {
        "service-1": binding(repositoryPath),
      })
    ).toEqual({ path: expectedPath, line: 1, column: 1 });
  });

  it("requires an exact stable service binding", () => {
    expect(
      resolveFileReferenceSource(value("src/Editor.tsx"), {
        "another-service": {
          ...binding("/work/other"),
          serviceId: "another-service",
        },
      })
    ).toBeNull();

    expect(
      resolveFileReferenceSource(value("src/Editor.tsx"), {
        "service-1": {
          ...binding("/work/other"),
          serviceId: "another-service",
        },
      })
    ).toBeNull();
  });

  it.each([
    "",
    "/absolute/path.ts",
    "\\absolute\\path.ts",
    "C:/absolute/path.ts",
    "C:\\absolute\\path.ts",
    "../outside.ts",
    "src/../outside.ts",
    "./src/file.ts",
    "src/./file.ts",
    "src//file.ts",
    "src/file.ts/",
    "src\\file.ts",
    "src/mixed\\file.ts",
  ])("rejects non-canonical relative path %s", (normalizedPath) => {
    expect(
      resolveFileReferenceSource(value(normalizedPath), {
        "service-1": binding("/work/ui-common"),
      })
    ).toBeNull();
  });

  it.each([
    "relative/root",
    "C:relative\\root",
    "\\\\server\\share",
    "/work\\mixed",
    "C:/work/mixed",
    "/work/../outside",
    "C:\\work\\..\\outside",
    "/work//ui-common",
    "C:\\work\\\\ui-common",
  ])("rejects an invalid repository root %s", (repositoryPath) => {
    expect(
      resolveFileReferenceSource(value("src/Editor.tsx"), {
        "service-1": binding(repositoryPath),
      })
    ).toBeNull();
  });
});
