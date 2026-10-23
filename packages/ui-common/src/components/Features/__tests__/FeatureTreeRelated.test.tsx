import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { DndContext } from "@dnd-kit/core";
import {
  TaskSource,
  WorkStatus,
  FeatureHierarchyEntryDtoDirectionEnum,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
  type TaskResponseDto,
  type FeatureHierarchyEntryDto,
} from "../../../api";
import { FeatureTreeVisualization } from "../FeatureTreeVisualization";
import { PathServiceProvider } from "../../../contexts";
import type { PathService } from "../../../services/webPathService";
import { referencesResponse } from "./featureTreeReferences";

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

import {
  unifiedApiClient,
  entityContextClient,
} from "../../../clients/serviceClients";

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

function makeFeature(
  id: string,
  parentTaskId?: string,
  name = `Feature ${id}`
): TaskResponseDto {
  return {
    id,
    name,
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.User,
    parentTaskId,
  };
}

const A = makeFeature("A");
const B = makeFeature("B");
const C = makeFeature("C");
const D = makeFeature("D");

const mockedUnified = vi.mocked(unifiedApiClient);
const mockedContext = vi.mocked(entityContextClient);

const mockPathService: PathService = {
  feature: ({ featureId }: { projectId: string; featureId: string }) =>
    `/features/${featureId}`,
  task: ({ taskId }: { projectId: string; taskId: string }) =>
    `/tasks/${taskId}`,
} as unknown as PathService;

// A fresh jotai store per render keeps the shared work-item collection (which
// now backs useFeatureTree) isolated between test cases.
function tree(activeFeatureId: string, orientation?: "left-to-right" | "top-down"): React.ReactElement {
  return (
    <Provider>
      <MemoryRouter>
        <PathServiceProvider pathService={mockPathService}>
          <DndContext>
            <FeatureTreeVisualization
              orientation={orientation}
              organizationId={ORG_ID}
              projectId={PROJ_ID}
              activeFeatureId={activeFeatureId}
            />
          </DndContext>
        </PathServiceProvider>
      </MemoryRouter>
    </Provider>
  );
}

function renderTree(activeFeatureId: string) {
  return render(tree(activeFeatureId));
}

function makeRelatedEntry(
  id: string,
  relationshipType: FeatureHierarchyEntryDtoRelationshipTypeEnum,
  direction: FeatureHierarchyEntryDtoDirectionEnum = FeatureHierarchyEntryDtoDirectionEnum.Outbound,
  reasoning?: string
): FeatureHierarchyEntryDto {
  return {
    id,
    name: `Related ${id}`,
    relationshipType,
    direction,
    reasoning,
  } as FeatureHierarchyEntryDto;
}

function setContextResponse(hierarchy: FeatureHierarchyEntryDto[]): void {
  mockedContext.getEntityContext.mockResolvedValue({
    data: {
      data: {
        featureHierarchy: hierarchy,
      },
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not implement scrollIntoView; FeatureTreeVisualization scrolls
  // the active card into view on mount.
  Element.prototype.scrollIntoView = vi.fn();
  mockedUnified.listWorkItemReferences.mockResolvedValue(
    referencesResponse([A, B, C, D]) as never
  );
  mockedUnified.getTasks.mockResolvedValue({
    data: { data: [A, B, C, D] },
  } as never);
  mockedUnified.updateTask.mockResolvedValue({
    data: { data: {} },
  } as never);
  setContextResponse([]);
});

async function openRelatedAttachment(): Promise<void> {
  const attachment = await screen.findByTestId("related-feature-attachment");
  fireEvent.click(attachment);
  await waitFor(() => {
    expect(
      screen.getByTestId("related-feature-attachment-panel")
    ).toBeInTheDocument();
  });
}

describe("FeatureTreeVisualization — related attachment rendering", () => {
  it("keeps the top-down attachment inside its branch and preserves expansion", async () => {
    setContextResponse([makeRelatedEntry("B", FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo)]);
    render(tree("A", "top-down"));
    const attachment = await screen.findByTestId("related-feature-attachment");
    const card = (await screen.findByText("Feature A")).closest('[data-testid="interaction-component"]');
    expect(attachment.parentElement).toContainElement(card);
    await openRelatedAttachment();
    expect(screen.getByTestId("related-feature-node-B")).toBeInTheDocument();
  });
  it("passes the FEATURE subtype to every recursive feature interaction surface", async () => {
    renderTree("A");

    const featureName = await screen.findByText("Feature A");
    const interactionSurface = featureName.closest(
      '[data-testid="interaction-component"]',
    );

    expect(interactionSurface).toHaveAttribute(
      "data-entity-subtype",
      "FEATURE",
    );
  });

  it("(a) renders one collapsed attachment when a RELATED_TO entry is present", async () => {
    setContextResponse([
      makeRelatedEntry(
        "B",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo
      ),
    ]);

    renderTree("A");

    const attachment = await screen.findByTestId("related-feature-attachment");

    expect(attachment).toHaveTextContent("1 related");
    expect(attachment).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("related-feature-node-B")
    ).not.toBeInTheDocument();

    await openRelatedAttachment();
    expect(attachment).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("related-feature-node-B")).toBeInTheDocument();
  });

  it("(b) renders every non-structural relationshipType without filtering", async () => {
    const types: FeatureHierarchyEntryDtoRelationshipTypeEnum[] = [
      FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo,
      FeatureHierarchyEntryDtoRelationshipTypeEnum.DependsOn,
      FeatureHierarchyEntryDtoRelationshipTypeEnum.DerivesFrom,
      FeatureHierarchyEntryDtoRelationshipTypeEnum.Supersedes,
      FeatureHierarchyEntryDtoRelationshipTypeEnum.Contradicts,
      FeatureHierarchyEntryDtoRelationshipTypeEnum.Evolves,
    ];

    const fixtureFeatures = types.map((_t, i) => makeFeature(`R${i}`));
    mockedUnified.listWorkItemReferences.mockResolvedValue(
      referencesResponse([A, ...fixtureFeatures]) as never
    );
    mockedUnified.getTasks.mockResolvedValue({
      data: { data: [A, ...fixtureFeatures] },
    } as never);

    setContextResponse(types.map((t, i) => makeRelatedEntry(`R${i}`, t)));

    renderTree("A");

    await screen.findByTestId("related-feature-attachment");
    await openRelatedAttachment();

    for (let i = 0; i < types.length; i++) {
      expect(
        screen.getByTestId(`related-feature-node-R${i}`)
      ).toBeInTheDocument();
    }
  });

  it("(c) shows the edge-type label on the connector", async () => {
    setContextResponse([
      makeRelatedEntry(
        "B",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.DependsOn
      ),
    ]);

    renderTree("A");

    await screen.findByTestId("related-feature-attachment");
    await openRelatedAttachment();

    const label = screen.getByTestId("related-feature-edge-label-B");
    expect(label.getAttribute("data-edge-type")).toBe(
      FeatureHierarchyEntryDtoRelationshipTypeEnum.DependsOn
    );
    expect(label).toHaveTextContent(/depends on/i);
    expect(label).toHaveTextContent(/outbound/i);
  });

  it("(d) distinguishes outbound vs inbound direction", async () => {
    setContextResponse([
      makeRelatedEntry(
        "B",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo,
        FeatureHierarchyEntryDtoDirectionEnum.Outbound
      ),
      makeRelatedEntry(
        "C",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo,
        FeatureHierarchyEntryDtoDirectionEnum.Inbound
      ),
    ]);

    renderTree("A");

    await screen.findByTestId("related-feature-attachment");
    await openRelatedAttachment();

    expect(
      screen
        .getByTestId("related-feature-edge-label-B")
        .getAttribute("data-edge-direction")
    ).toBe("outbound");
    expect(
      screen
        .getByTestId("related-feature-edge-label-C")
        .getAttribute("data-edge-direction")
    ).toBe("inbound");
  });

  it("(e) clicking the related node navigates to its feature path", async () => {
    setContextResponse([
      makeRelatedEntry(
        "B",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo
      ),
    ]);

    renderTree("A");

    await screen.findByTestId("related-feature-attachment");
    await openRelatedAttachment();

    const node = screen.getByTestId("related-feature-node-B");
    const anchor = node.querySelector('a[href="/features/B"]');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute("aria-roledescription", "draggable");
  });

  it("closes the attachment when the active seed changes", async () => {
    setContextResponse([
      makeRelatedEntry(
        "B",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo
      ),
    ]);

    const rendered = renderTree("A");
    await openRelatedAttachment();
    expect(screen.getByTestId("related-feature-attachment")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await act(async () => {
      rendered.rerender(tree("D"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("related-feature-attachment")).toHaveAttribute(
        "aria-expanded",
        "false"
      );
    });
  });

  it("does not fetch entity context when no activeFeatureId is provided", async () => {
    render(
      <Provider>
        <MemoryRouter>
          <PathServiceProvider pathService={mockPathService}>
            <FeatureTreeVisualization
              organizationId={ORG_ID}
              projectId={PROJ_ID}
            />
          </PathServiceProvider>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(mockedUnified.listWorkItemReferences).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          projectId: PROJ_ID,
          type: "FEATURE",
        }),
        expect.anything()
      );
    });
    await screen.findByText("Feature A");
    // The tree hydrates metadata only: no request asks for document sections.
    for (const [params] of mockedUnified.getTasks.mock.calls) {
      expect(params.includeSectionKeys ?? []).not.toContain("description");
      expect(params.includeSectionKeys ?? []).not.toContain("requirements");
    }

    // Allow effect cycles
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedContext.getEntityContext).not.toHaveBeenCalled();
  });

  it("filters out structural entries from the related attachment", async () => {
    setContextResponse([
      {
        id: "B",
        name: "Sibling B",
        relationshipType:
          FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural,
        relationship: "sibling",
        distance: 1,
      } as FeatureHierarchyEntryDto,
      makeRelatedEntry(
        "C",
        FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo
      ),
    ]);

    renderTree("A");

    await screen.findByTestId("related-feature-attachment");
    await openRelatedAttachment();

    expect(
      screen.queryByTestId("related-feature-node-B")
    ).not.toBeInTheDocument();
  });
});
