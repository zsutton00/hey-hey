import { describe, expect, it } from "vitest";
import { artifactKeys } from "../artifacts";
describe("artifact keys", () => {
  it("separates list, detail, tenant, project and server filters", () => {
    const list = artifactKeys.list("org", "project");
    expect(artifactKeys.detail("org", "item")).not.toEqual(list);
    expect(artifactKeys.list("other", "project")).not.toEqual(list);
    expect(artifactKeys.list("org", "other")).not.toEqual(list);
    expect(
      artifactKeys.list("org", "project", {
        sourceId: "source",
        publicOnly: false,
      })
    ).not.toEqual(list);
  });
});
