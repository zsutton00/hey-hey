import { access } from "node:fs/promises";
import path from "node:path";
import { createUiCommonPuckIntegration } from "../vite-linked-dependencies";

describe("linked ui-common runtime dependencies", () => {
  it("pre-bundles Puck from ui-common before route discovery", async () => {
    const uiCommonRoot = path.resolve(
      __dirname,
      "../.worktree-links/ui-common",
    );
    const integration = createUiCommonPuckIntegration(uiCommonRoot);

    expect(integration.optimizeDepsInclude).toContain("@puckeditor/core");
    expect(integration.alias.find.test("@puckeditor/core")).toBe(true);
    await expect(access(integration.alias.replacement)).resolves.toBeUndefined();
  });
});
