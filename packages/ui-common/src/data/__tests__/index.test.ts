import { describe, expect, it } from "vitest";
import {
  getCascadeImpactConflict,
  useAllowedParentEntityTypes,
  useArchiveWorkItemType,
  useCanParentEntityType,
  useCanonicalPlanAggregate,
  useEditWorkItemType,
  useHardDeleteWorkItemType,
  useMarkHardDeletedWorkItemTypeDataStale,
  useRefreshWorkItemType,
  useRestoreWorkItemType,
  useResetWorkItemType,
  useWorkItemTypeCascadeImpact,
  useWorkItemTypeSectionContentImpact,
  useWorkItemTypeTrackingLinkRevocationImpact,
} from "../index";

describe("data public entry point", () => {
  it("exports the complete work-item-type lifecycle surface", () => {
    expect(getCascadeImpactConflict).toEqual(expect.any(Function));
    expect(useArchiveWorkItemType).toEqual(expect.any(Function));
    expect(useEditWorkItemType).toEqual(expect.any(Function));
    expect(useHardDeleteWorkItemType).toEqual(expect.any(Function));
    expect(useMarkHardDeletedWorkItemTypeDataStale).toEqual(
      expect.any(Function)
    );
    expect(useRefreshWorkItemType).toEqual(expect.any(Function));
    expect(useRestoreWorkItemType).toEqual(expect.any(Function));
    expect(useResetWorkItemType).toEqual(expect.any(Function));
    expect(useWorkItemTypeCascadeImpact).toEqual(expect.any(Function));
    expect(useWorkItemTypeSectionContentImpact).toEqual(expect.any(Function));
    expect(useWorkItemTypeTrackingLinkRevocationImpact).toEqual(
      expect.any(Function)
    );
  });

  it("exports entity-type parentage hooks", () => {
    expect(useAllowedParentEntityTypes).toEqual(expect.any(Function));
    expect(useCanParentEntityType).toEqual(expect.any(Function));
  });

  it("exports the canonical plan aggregate hook", () => {
    expect(useCanonicalPlanAggregate).toEqual(expect.any(Function));
  });
});
