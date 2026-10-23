import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BreadcrumbLink } from "../BreadcrumbLink";

vi.mock("../../data/hooks/useProject", () => ({
  useProject: vi.fn(),
}));

vi.mock("../../data/hooks/useInitiative", () => ({
  useInitiative: vi.fn(),
}));

vi.mock("../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(),
}));

vi.mock("../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: vi.fn(),
}));

vi.mock("../../services/authService", () => ({
  getAuthToken: vi.fn(),
}));

// Stub InteractionComponent so the task/design-doc drag path can be asserted
// without pulling in its full dependency tree (path service, entity context,
// conversation launcher). The stub surfaces the entity ref it was handed.
vi.mock("../InteractionComponent", () => ({
  InteractionComponent: ({
    entityId,
    entityType,
    entitySubtype,
    idScope,
    children,
  }: {
    entityId: string;
    entityType: string;
    entitySubtype?: string;
    idScope?: string;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="interaction-component"
      data-entity-id={entityId}
      data-entity-type={entityType}
      data-entity-subtype={entitySubtype}
      data-id-scope={idScope}
    >
      {children}
    </div>
  ),
}));

import { useProject } from "../../data/hooks/useProject";
import { useInitiative } from "../../data/hooks/useInitiative";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useDesignDoc } from "../../data/hooks/useDesignDoc";
import { getAuthToken } from "../../services/authService";

const mockUseProject = useProject as ReturnType<typeof vi.fn>;
const mockUseInitiative = useInitiative as ReturnType<typeof vi.fn>;
const mockUseWorkItem = useWorkItem as ReturnType<typeof vi.fn>;
const mockUseDesignDoc = useDesignDoc as ReturnType<typeof vi.fn>;
const mockGetAuthToken = getAuthToken as ReturnType<typeof vi.fn>;

const encodeBase64 = (value: string): string => {
  if (typeof btoa === "function") {
    return btoa(value);
  }

  return Buffer.from(value, "utf-8").toString("base64");
};

const buildTokenWithOrgId = (orgId: string): string => {
  const payload = encodeBase64(JSON.stringify({ currentOrgId: orgId }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `header.${payload}.signature`;
};

describe("BreadcrumbLink", () => {
  const defaultProjectQuery = {
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  };

  const defaultInitiativeQuery = {
    data: null,
    isLoading: false,
    error: null,
    isStale: false,
    update: vi.fn(),
    refetch: vi.fn(),
    markStale: vi.fn(),
  };

  const defaultWorkItemQuery = {
    workItem: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  };

  const defaultDesignDocQuery = {
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockReturnValue(buildTokenWithOrgId("org-1"));
    mockUseProject.mockReturnValue(defaultProjectQuery);
    mockUseInitiative.mockReturnValue(defaultInitiativeQuery);
    mockUseWorkItem.mockReturnValue(defaultWorkItemQuery);
    mockUseDesignDoc.mockReturnValue(defaultDesignDocQuery);
  });

  it("resolves project breadcrumb labels from UUID to project name", () => {
    const projectId = "196b5366-10db-40f8-adf5-c4d6a03357f8";
    mockUseProject.mockReturnValue({
      ...defaultProjectQuery,
      data: { name: "Resolved Project" },
    });

    render(
      <MemoryRouter>
        <BreadcrumbLink to={`/projects/${projectId}`} type="project">
          {projectId}
        </BreadcrumbLink>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("breadcrumb-link-label")).toHaveTextContent(
      "Resolved Project",
    );
    expect(mockUseProject).toHaveBeenCalledWith(
      "org-1",
      projectId,
      expect.objectContaining({
        enabled: true,
        preferStale: true,
      }),
    );
  });

  it("resolves Plan breadcrumb labels from the canonical Work Item", () => {
    const planId = "6c5f4ed8-df48-4fc6-a863-7646766f7dc1";
    mockUseWorkItem.mockReturnValue({
      ...defaultWorkItemQuery,
      workItem: {
        id: planId,
        name: "Resolved Plan",
        type: "PLAN",
        parentTaskId: "feature-1",
      },
    });

    render(
      <MemoryRouter>
        <BreadcrumbLink to={`/projects/project-1/plans/${planId}`} type="plan">
          {planId}
        </BreadcrumbLink>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("breadcrumb-link-label")).toHaveTextContent(
      "Resolved Plan",
    );
    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      planId,
      expect.objectContaining({
        projectId: "project-1",
        enabled: true,
        preferStale: true,
      }),
    );
  });

  it("keeps non-UUID labels unchanged and does not leak them into the cache key", () => {
    render(
      <MemoryRouter>
        <BreadcrumbLink to="/projects/project-1/plans/plan-1" type="plan">
          Human Label
        </BreadcrumbLink>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("breadcrumb-link-label")).toHaveTextContent(
      "Human Label",
    );
    // The human-readable label must never reach the resolver hook as an id —
    // it would register a dead cache entry keyed by the label. The sentinel is
    // passed instead while the query stays disabled.
    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "__noop__",
      expect.objectContaining({
        projectId: "project-1",
        enabled: false,
        preferStale: true,
      }),
    );
  });

  it("does not pass project names into useProject as a projectId", () => {
    render(
      <MemoryRouter>
        <BreadcrumbLink to="/projects/Hey%20Hey%204" type="project">
          Hey Hey 4
        </BreadcrumbLink>
      </MemoryRouter>,
    );

    expect(mockUseProject).toHaveBeenCalledWith(
      "org-1",
      undefined,
      expect.objectContaining({
        enabled: false,
        preferStale: true,
      }),
    );
  });

  it("truncates internal breadcrumbs to 24 characters with a single-char ellipsis", () => {
    render(
      <MemoryRouter>
        <BreadcrumbLink to="/projects/project-1/plans/plan-1" type="plan">
          1234567890123456789012345678901234567890
        </BreadcrumbLink>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("breadcrumb-link-label")).toHaveTextContent(
      "12345678901234567890123…",
    );
  });

  it("truncates the current breadcrumb to 40 characters with a single-char ellipsis", () => {
    render(
      <MemoryRouter>
        <BreadcrumbLink isCurrentPage type="plan">
          12345678901234567890123456789012345678901234567890
        </BreadcrumbLink>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("breadcrumb-link-label")).toHaveTextContent(
      "123456789012345678901234567890123456789…",
    );
  });

  describe("drag source", () => {
    it("routes task segments through InteractionComponent to preserve the context menu", () => {
      render(
        <MemoryRouter>
          <BreadcrumbLink
            to="/projects/p1/tasks/t1"
            type="task"
            entityId="task-1"
          >
            A Task
          </BreadcrumbLink>
        </MemoryRouter>,
      );

      const interaction = screen.getByTestId("interaction-component");
      expect(interaction).toHaveAttribute("data-entity-id", "task-1");
      expect(interaction).toHaveAttribute("data-entity-type", "TASK");
      expect(interaction).toHaveAttribute("data-id-scope", "breadcrumb");
      expect(screen.queryByTestId("breadcrumb-drag-source")).toBeNull();
    });

    it("maps feature segments to the task drag type with a subtype", () => {
      render(
        <MemoryRouter>
          <BreadcrumbLink
            to="/projects/p1/tasks/f1"
            type="feature"
            entityId="feat-1"
          >
            A Feature
          </BreadcrumbLink>
        </MemoryRouter>,
      );

      const interaction = screen.getByTestId("interaction-component");
      expect(interaction).toHaveAttribute("data-entity-type", "TASK");
      expect(interaction).toHaveAttribute("data-entity-subtype", "feature");
    });

    it("routes design-doc segments through InteractionComponent", () => {
      render(
        <MemoryRouter>
          <BreadcrumbLink
            to="/projects/p1/documents/d1"
            type="design_doc"
            entityId="dd-1"
          >
            A Doc
          </BreadcrumbLink>
        </MemoryRouter>,
      );

      const interaction = screen.getByTestId("interaction-component");
      expect(interaction).toHaveAttribute("data-entity-id", "dd-1");
      expect(interaction).toHaveAttribute("data-entity-type", "DESIGN_DOC");
    });

    it.each([
      ["project", "PROJECT", "proj-1"],
      ["plan", "TASK", "plan-1"],
      ["initiative", "INITIATIVE", "init-1"],
    ])(
      "exposes a pure drag source for %s segments without InteractionComponent",
      (type, expectedType, id) => {
        render(
          <MemoryRouter>
            <BreadcrumbLink to={`/projects/${id}`} type={type} entityId={id}>
              Human Label
            </BreadcrumbLink>
          </MemoryRouter>,
        );

        const dragSource = screen.getByTestId("breadcrumb-drag-source");
        expect(dragSource).toHaveAttribute("data-entity-id", id);
        expect(dragSource).toHaveAttribute("data-entity-type", expectedType);
        expect(screen.queryByTestId("interaction-component")).toBeNull();
      },
    );

    it("leaves an entity-typed segment non-draggable when it carries no entity id", () => {
      render(
        <MemoryRouter>
          <BreadcrumbLink to="/projects/p1" type="project">
            Acme Project
          </BreadcrumbLink>
        </MemoryRouter>,
      );

      expect(screen.queryByTestId("breadcrumb-drag-source")).toBeNull();
      expect(screen.queryByTestId("interaction-component")).toBeNull();
    });

    it("leaves a plain (typeless) fragment non-draggable", () => {
      render(
        <MemoryRouter>
          <BreadcrumbLink to="/projects">Projects</BreadcrumbLink>
        </MemoryRouter>,
      );

      expect(screen.queryByTestId("breadcrumb-drag-source")).toBeNull();
      expect(screen.queryByTestId("interaction-component")).toBeNull();
    });
  });
});
