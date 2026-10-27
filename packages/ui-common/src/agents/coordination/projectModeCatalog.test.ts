import { describe, expect, it } from "vitest";
import type { WorkItemTypeSummaryDto } from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import {
  isProjectModeSelectionEligible,
  mapProjectModeCatalog,
} from "./projectModeCatalog";

const mode = (
  id: string,
  name: string,
  description: string,
  overrides: Omit<Partial<WorkItemResponseDto>, "archivedAt"> & {
    archivedAt?: string | null;
  } = {},
): WorkItemResponseDto =>
  ({
    id,
    name,
    type: "MODE",
    projectId: "project-1",
    status: "ACTIVE",
    sections: [
      {
        id: `${id}-description`,
        key: "description",
        order: 0,
        materializedMarkdown: description,
        materializedProposalId: "proposal-1",
      },
    ],
    ...overrides,
  }) as WorkItemResponseDto;

const modeTypeSummary = {
  id: "mode-type",
  projectId: "project-1",
  status: "ACTIVE",
  effectiveSource: "PROJECT_CUSTOM",
  definition: {
    key: "MODE",
    name: "Project mode",
    role: "project-info",
    sections: [],
    allowedStatuses: [],
  },
} as WorkItemTypeSummaryDto;

const withEligibleTypes = (
  base: WorkItemResponseDto,
  eligibleWorkItemTypeKeys: string[],
): WorkItemResponseDto =>
  ({
    ...base,
    sections: [
      ...(base.sections ?? []),
      {
        id: `${base.id}-settings`,
        key: "settings",
        order: 1,
        materializedMarkdown: JSON.stringify({
          schemaVersion: "project-mode-settings.v1",
          projectAssistant: { enabled: true },
          eligibleWorkItemTypeKeys,
        }),
        materializedProposalId: "proposal-1",
      },
    ],
  }) as WorkItemResponseDto;

describe("mapProjectModeCatalog", () => {
  it("filters each mode by its own eligible type list", () => {
    const diagrams = withEligibleTypes(
      mode("mode-diagrams", "Diagrams", "Diagram work."),
      ["STANDARD", "BUG"],
    );
    const review = withEligibleTypes(
      mode("mode-review", "Review", "Review work."),
      ["STANDARD"],
    );
    const unlisted = mode("mode-unlisted", "Unlisted", "Standard work.");
    const catalogFor = (effectiveWorkItemTypeKey: string) =>
      mapProjectModeCatalog({
        projectId: "project-1",
        effectiveWorkItemTypeKey,
        modeTypeSummary,
        modeItems: [diagrams, review, unlisted],
        reservedIdentities: new Set(),
      }).map((entry) => entry.selection.modeId);

    expect(catalogFor("STANDARD")).toEqual([
      "mode-diagrams",
      "mode-review",
      "mode-unlisted",
    ]);
    expect(catalogFor("BUG")).toEqual(["mode-diagrams"]);
  });

  it("intersects a per-mode list with Feature scope", () => {
    const scoped = withEligibleTypes(
      mode("mode-scoped", "Scoped", "Scoped work.", {
        edges: [
          {
            type: "DEPENDS_ON",
            sourceNodeId: "mode-scoped",
            targetNodeId: "feature-other",
            targetNodeType: "FEATURE",
          },
        ],
      } as Partial<WorkItemResponseDto>),
      ["BUG"],
    );

    expect(
      mapProjectModeCatalog({
        projectId: "project-1",
        effectiveWorkItemTypeKey: "BUG",
        modeTypeSummary,
        modeItems: [scoped],
        focalFeatureIds: new Set(["feature-1"]),
        reservedIdentities: new Set(),
      }),
    ).toEqual([]);
  });

  it("drops a stale BUG selection when the mode's list no longer allows it", () => {
    const catalog = mapProjectModeCatalog({
      projectId: "project-1",
      effectiveWorkItemTypeKey: "BUG",
      modeTypeSummary,
      modeItems: [
        withEligibleTypes(mode("mode-review", "Review", "Review."), [
          "STANDARD",
        ]),
      ],
      reservedIdentities: new Set(),
    });

    expect(
      isProjectModeSelectionEligible(
        { schemaVersion: "project-mode-selection.v1", modeId: "mode-review" },
        catalog,
      ),
    ).toBe(false);
  });

  it("keeps active, well-formed applicable modes in deterministic order", () => {
    const catalog = mapProjectModeCatalog({
      projectId: "project-1",
      effectiveWorkItemTypeKey: "STANDARD",
      modeTypeSummary,
      modeItems: [
        mode("mode-z", "Zed", "Z description", { archivedAt: null }),
        mode("mode-a", "Alpha", "A description"),
      ],
    });

    expect(catalog).toEqual([
      {
        selection: {
          schemaVersion: "project-mode-selection.v1",
          modeId: "mode-a",
        },
        name: "Alpha",
        description: "A description",
      },
      {
        selection: {
          schemaVersion: "project-mode-selection.v1",
          modeId: "mode-z",
        },
        name: "Zed",
        description: "Z description",
      },
    ]);
  });

  it("rejects archived, malformed, out-of-project, ineligible, and reserved modes", () => {
    const catalog = mapProjectModeCatalog({
      projectId: "project-1",
      effectiveWorkItemTypeKey: "STANDARD",
      modeTypeSummary,
      modeItems: [
        mode("archived", "Archived", "description", {
          archivedAt: "2026-09-01T00:00:00.000Z",
        }),
        mode("malformed", "Malformed", "", {}),
        mode("other-project", "Other", "description", {
          projectId: "project-2",
        }),
        withEligibleTypes(mode("ineligible", "Ineligible", "description"), [
          "BUG",
        ]),
        mode("plan", "Reserved", "description"),
      ],
    });

    expect(catalog).toEqual([]);
  });

  it("uses only outbound MODE-to-FEATURE DEPENDS_ON edges for Feature scope", () => {
    const catalog = mapProjectModeCatalog({
      projectId: "project-1",
      effectiveWorkItemTypeKey: "STANDARD",
      modeTypeSummary,
      focalFeatureIds: new Set([
        "feature-exact",
        "feature-ancestor",
        "feature-descendant",
      ]),
      modeItems: [
        mode("global", "Global", "description"),
        mode("exact", "Exact", "description", {
          edges: [
            {
              sourceNodeId: "exact",
              targetNodeId: "feature-exact",
              targetNodeType: "FEATURE",
              type: "DEPENDS_ON",
            },
          ],
        } as never),
        mode("descendant", "Descendant", "description", {
          edges: [
            {
              sourceNodeId: "descendant",
              targetNodeId: "feature-ancestor",
              targetNodeType: "FEATURE",
              type: "DEPENDS_ON",
            },
          ],
        } as never),
        mode("unrelated", "Unrelated", "description", {
          edges: [
            {
              sourceNodeId: "unrelated",
              targetNodeId: "feature-other",
              targetNodeType: "FEATURE",
              type: "DEPENDS_ON",
            },
          ],
        } as never),
        mode("structural-only", "Structural only", "description", {
          parentTaskId: "feature-exact",
          edges: [
            {
              sourceNodeId: "structural-only",
              targetNodeId: "feature-exact",
              targetNodeType: "FEATURE",
              type: "RELATED_TO",
            },
          ],
        } as never),
      ],
    });

    expect(catalog.map((entry) => entry.selection.modeId)).toEqual([
      "descendant",
      "exact",
      "global",
      "structural-only",
    ]);
  });

  it("fails closed when the MODE registry definition or focal type is unavailable", () => {
    expect(
      mapProjectModeCatalog({
        projectId: "project-1",
        effectiveWorkItemTypeKey: null,
        modeTypeSummary,
        modeItems: [mode("mode-1", "Mode", "description")],
      }),
    ).toEqual([]);
  });

  it("validates stored identities against the current catalog", () => {
    const catalog = mapProjectModeCatalog({
      projectId: "project-1",
      effectiveWorkItemTypeKey: "STANDARD",
      modeTypeSummary,
      modeItems: [mode("mode-1", "Mode", "description")],
    });

    expect(isProjectModeSelectionEligible(catalog[0]?.selection, catalog)).toBe(
      true,
    );
    expect(
      isProjectModeSelectionEligible(
        { schemaVersion: "project-mode-selection.v1", modeId: "stale" },
        catalog,
      ),
    ).toBe(false);
  });
});
