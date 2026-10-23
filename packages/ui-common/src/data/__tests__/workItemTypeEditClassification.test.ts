import { describe, expect, it } from "vitest";
import {
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "../../api";
import {
  analyzeWorkItemTypeEdit,
  classifyWorkItemTypeEdit,
  resolveWorkItemTypeKey,
} from "../workItemTypeEditClassification";

const definition: WorkItemTypeDefinitionDto = {
  key: "CUSTOM",
  name: "Custom",
  description: "Custom work",
  sections: [{ key: "details", label: "Details" }],
  allowedStatuses: ["NOT_STARTED"],
  allowedParentTypes: ["FEATURE"],
  allowedParentEntityTypes: ["PROJECT"],
  tracking: {
    allowedSourceEntityTypes: ["TASK"],
    allowedSourceTaskTypes: ["FEATURE", "STANDARD"],
  },
  capabilities: { rendersInline: true },
};

const summary = (
  currentDefinition: WorkItemTypeDefinitionDto,
): WorkItemTypeSummaryDto => ({
  id: "type-id",
  definition: currentDefinition,
  status: WorkItemTypeLifecycleStatus.Active,
  projectId: "project-1",
  effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
});

describe("work-item-type edit classification", () => {
  it("uses the stored definition key when form identity is blank or stale", () => {
    const stored = summary({ ...definition, key: "STORED_KEY" });

    expect(resolveWorkItemTypeKey(stored, "")).toBe("STORED_KEY");
    expect(resolveWorkItemTypeKey(stored, "STALE_KEY")).toBe("STORED_KEY");
  });

  it("normalizes the form key when creating a type", () => {
    expect(resolveWorkItemTypeKey(undefined, " custom_key ")).toBe(
      "CUSTOM_KEY",
    );
  });

  it("keeps a presence-faithful round trip unchanged", () => {
    expect(analyzeWorkItemTypeEdit(summary(definition), definition)).toMatchObject({
      kind: "unchanged",
      addedSectionKeys: [],
      requiresConfirmation: false,
    });
  });

  it("allows semantic edits across authorable fields", () => {
    const proposed: WorkItemTypeDefinitionDto = {
      ...definition,
      name: "Campaign",
      description: "Campaign work",
      sections: [{ key: "details", label: "Campaign details" }],
      allowedStatuses: ["ACTIVE", "COMPLETED"],
      allowedParentTypes: [],
      allowedParentEntityTypes: [],
      tracking: {
        allowedSourceEntityTypes: ["PLAN"],
        allowedSourceTaskTypes: [...definition.tracking!.allowedSourceTaskTypes, "PLAN"],
      },
      writingStandards: { create: "Create well.", edit: "Edit well." },
      capabilities: { rendersInline: false },
    };

    expect(classifyWorkItemTypeEdit(summary(definition), proposed)).toMatchObject({
      kind: "authorable",
      unsupportedReasonCodes: [],
      unsupportedReasons: [],
    });
  });

  it("rejects a new parent-required type shown in the Explorer Sidebar", () => {
    const analysis = analyzeWorkItemTypeEdit(undefined, {
      ...definition,
      capabilities: {
        ...definition.capabilities,
        requiresParent: true,
        showsInExplorerSidebar: true,
      },
    });

    expect(analysis).toMatchObject({
      kind: "unsupported",
      unsupportedReasonCodes: [
        "REQUIRES_PARENT_CANNOT_SHOW_IN_EXPLORER_SIDEBAR",
      ],
      unsupportedReasons: [
        "Explorer Sidebar entries are top-level, so a work-item type that requires a parent cannot be shown there.",
      ],
      requiresConfirmation: false,
    });
  });

  it("rejects an edit that makes a parent-required type visible in the Explorer Sidebar", () => {
    const classification = classifyWorkItemTypeEdit(summary(definition), {
      ...definition,
      capabilities: {
        ...definition.capabilities,
        requiresParent: true,
        showsInExplorerSidebar: true,
      },
    });

    expect(classification).toMatchObject({
      kind: "unsupported",
      unsupportedReasonCodes: [
        "REQUIRES_PARENT_CANNOT_SHOW_IN_EXPLORER_SIDEBAR",
      ],
      unsupportedReasons: [
        "Explorer Sidebar entries are top-level, so a work-item type that requires a parent cannot be shown there.",
      ],
    });
    expect(classification.guidance).toBeUndefined();
  });

  it("requires confirmation for section and tracking-source removal", () => {
    const proposed: WorkItemTypeDefinitionDto = {
      ...definition,
      sections: [],
      tracking: {
        ...definition.tracking!,
        allowedSourceTaskTypes: ["FEATURE"],
      },
    };

    expect(analyzeWorkItemTypeEdit(summary(definition), proposed)).toMatchObject({
      kind: "supported_destructive",
      removedSectionKeys: ["details"],
      revokedTrackingSourceTypeKeys: ["STANDARD"],
      requiresConfirmation: true,
    });
  });

  it("refuses stable key changes", () => {
    const classification = classifyWorkItemTypeEdit(summary(definition), {
      ...definition,
      key: "OTHER",
      capabilities: { rendersInline: false },
    });

    expect(classification.kind).toBe("unsupported");
    expect(classification.unsupportedReasonCodes).toEqual([
      "IDENTITY_KEY_CHANGED",
    ]);
  });
});
