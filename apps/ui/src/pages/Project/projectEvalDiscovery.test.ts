import {
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import { buildProjectWorkspaceNavigation } from "@hey-hey/ui-common/data";
import { describe, expect, it } from "vitest";
import { selectProjectEvalType } from "./projectEvalDiscovery";

const evalType: WorkItemTypeSummaryDto = {
  id: "type-eval",
  projectId: "project-1",
  status: WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  definition: {
    key: "EVAL",
    name: "Evaluations",
    role: WorkItemTypeRole.Monitor,
    sections: [],
    allowedStatuses: [],
  },
};
describe("selectProjectEvalType", () => {
  it("uses the project's active monitor definition without changing role projections", () => {
    expect(selectProjectEvalType([evalType], "project-1", true)).toBe(evalType);
    const { groups } = buildProjectWorkspaceNavigation([evalType], "project-1");
    expect(JSON.stringify(groups)).not.toContain('"EVAL"');
  });
  it("withholds stale definitions before readiness and after project switching", () => {
    expect(
      selectProjectEvalType([evalType], "project-1", false),
    ).toBeUndefined();
    expect(
      selectProjectEvalType([evalType], "project-2", true),
    ).toBeUndefined();
    expect(selectProjectEvalType([], "project-1", true)).toBeUndefined();
  });
  it.each([WorkItemTypeLifecycleStatus.Archived])(
    "rejects %s definitions",
    (status) => {
      expect(
        selectProjectEvalType([{ ...evalType, status }], "project-1", true),
      ).toBeUndefined();
    },
  );
  it("rejects other roles and keys", () => {
    for (const definition of [
      { ...evalType.definition, role: WorkItemTypeRole.ProjectInfo },
      { ...evalType.definition, key: "EVAL_CASE" },
    ]) {
      expect(
        selectProjectEvalType([{ ...evalType, definition }], "project-1", true),
      ).toBeUndefined();
    }
  });
});
