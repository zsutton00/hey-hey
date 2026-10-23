import React from "react";
import { referencesResponse } from "./featureTreeReferences";
import { DndContext } from "@dnd-kit/core";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeatureHierarchyEntryDtoRelationshipEnum,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
  TaskSource,
  WorkStatus,
  type FeatureHierarchyEntryDto,
  type TaskResponseDto,
} from "../../../api";
import {
  entityContextClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import { PathServiceProvider } from "../../../contexts";
import type { PathService } from "../../../services/webPathService";
import { FeatureTreeVisualization } from "../FeatureTreeVisualization";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    listWorkItemReferences: vi.fn(),
    updateTask: vi.fn(),
  },
  entityContextClient: {
    getEntityContext: vi.fn(),
  },
}));

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";
const FOCUSED_FEATURE_ID = "feature-focused";

function makeFeature(
  id: string,
  name: string,
  parentTaskId?: string
): TaskResponseDto {
  return {
    id,
    name,
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.User,
    parentTaskId,
  };
}

function makeStructuralEntry(
  id: string,
  relationship: FeatureHierarchyEntryDtoRelationshipEnum,
  distance: number
): FeatureHierarchyEntryDto {
  return {
    id,
    name: id,
    relationshipType: FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural,
    relationship,
    distance,
  };
}

const pathService: PathService = {
  feature: ({ featureId }: { projectId: string; featureId: string }) =>
    `/features/${featureId}`,
} as PathService;

const mockedApi = vi.mocked(unifiedApiClient);
const mockedContext = vi.mocked(entityContextClient);

const focusedFeatureHierarchy: FeatureHierarchyEntryDto[] = [
  makeStructuralEntry(
    "feature-parent",
    FeatureHierarchyEntryDtoRelationshipEnum.Ancestor,
    1
  ),
  makeStructuralEntry(
    "feature-grandparent",
    FeatureHierarchyEntryDtoRelationshipEnum.Ancestor,
    2
  ),
  makeStructuralEntry(
    "feature-sibling",
    FeatureHierarchyEntryDtoRelationshipEnum.Sibling,
    1
  ),
  makeStructuralEntry(
    "feature-child",
    FeatureHierarchyEntryDtoRelationshipEnum.Descendant,
    1
  ),
  makeStructuralEntry(
    "feature-grandchild",
    FeatureHierarchyEntryDtoRelationshipEnum.Descendant,
    2
  ),
  {
    id: "feature-related",
    name: "Related Feature",
    relationshipType: FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  const features = [
    makeFeature("feature-grandparent", "Grandparent Feature"),
    makeFeature("feature-parent", "Parent Feature", "feature-grandparent"),
    makeFeature(FOCUSED_FEATURE_ID, "Focused Feature", "feature-parent"),
    makeFeature("feature-child", "Direct Child", FOCUSED_FEATURE_ID),
    makeFeature("feature-grandchild", "Grandchild", "feature-child"),
    makeFeature("feature-sibling", "Sibling", "feature-parent"),
    makeFeature("feature-unrelated", "Unrelated Feature"),
  ];
  mockedApi.listWorkItemReferences.mockResolvedValue(
    referencesResponse(features) as never
  );
  mockedApi.getTasks.mockImplementation(
    async (params) =>
      ({
        data: {
          data: features.filter((feature) =>
            params.taskIds?.includes(feature.id)
          ),
        },
      } as never)
  );
  mockedContext.getEntityContext.mockResolvedValue({
    data: {
      data: {
        featureHierarchy: focusedFeatureHierarchy.filter(
          (entry) =>
            entry.relationshipType !==
            FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural
        ),
      },
    },
  } as never);
});

function renderLocalTree() {
  render(
    <Provider>
      <MemoryRouter>
        <PathServiceProvider pathService={pathService}>
          <DndContext>
            <FeatureTreeVisualization
              organizationId={ORG_ID}
              projectId={PROJECT_ID}
              dataSource="local-neighborhood"
              focusedFeatureId={FOCUSED_FEATURE_ID}
              activeFeatureId={FOCUSED_FEATURE_ID}
              fillHeight={false}
            />
          </DndContext>
        </PathServiceProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe("FeatureTreeVisualization local neighborhood source", () => {
  it("opens the structural neighborhood while the related-feature context read is pending", async () => {
    mockedContext.getEntityContext.mockImplementation(
      () => new Promise(() => {}) as never
    );
    renderLocalTree();
    expect(await screen.findByText("Focused Feature")).toBeVisible();
    expect(screen.getByText("Parent Feature")).toBeVisible();
    expect(screen.getByText("Direct Child")).toBeVisible();
    expect(screen.queryByText("Grandparent Feature")).not.toBeInTheDocument();
  });

  it("hydrates and renders only the focused feature, its parent, and direct children", async () => {
    renderLocalTree();

    expect(await screen.findByText("Parent Feature")).toBeVisible();
    expect(screen.getByText("Focused Feature")).toBeVisible();
    expect(screen.getByText("Direct Child")).toBeVisible();
    expect(screen.queryByText("Unrelated Feature")).not.toBeInTheDocument();
    expect(screen.queryByText("Grandparent Feature")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApi.getTasks).toHaveBeenCalled();
    });
    const featureRequest = mockedApi.getTasks.mock.calls[0][0] as {
      taskIds?: string[];
      type?: string;
      limit?: number;
      includeSectionKeys?: string[];
    };
    expect(featureRequest).toMatchObject({
      taskIds: ["feature-parent", FOCUSED_FEATURE_ID, "feature-child"],
      type: "FEATURE",
      limit: 500,
    });
    expect(featureRequest.includeSectionKeys).toBeUndefined();
  });
});
