import {
  BrainstormStatus,
  DesignDocTemplate,
} from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";
import { isDesignDocRefining } from "./statusUtils";

describe("isDesignDocRefining", () => {
  it("treats PLAN_DOCUMENT refining content as refining", () => {
    expect(
      isDesignDocRefining({
        template: DesignDocTemplate.PlanDocument,
        status: BrainstormStatus.RefiningContent,
      }),
    ).toBe(true);
  });
});
