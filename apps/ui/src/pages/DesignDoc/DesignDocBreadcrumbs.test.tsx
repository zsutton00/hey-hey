import {
  DesignDocParentEntityType,
  type DesignDocResponseDto,
} from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesignDocBreadcrumbs } from "./DesignDocBreadcrumbs";

const mockUseDesignDoc = vi.fn();
const mockUseWorkItem = vi.fn();
const mockUseProject = vi.fn();
const mockUsePlan = vi.fn();
const mockUseInitiative = vi.fn();
const mockGetAuthToken = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useDesignDoc: (...args: unknown[]) => mockUseDesignDoc(...args),
  useWorkItem: (...args: unknown[]) => mockUseWorkItem(...args),
  useProject: (...args: unknown[]) => mockUseProject(...args),
  usePlan: (...args: unknown[]) => mockUsePlan(...args),
  useInitiative: (...args: unknown[]) => mockUseInitiative(...args),
}));

vi.mock("@hey-hey/ui-common/services", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/services")
  >("@hey-hey/ui-common/services");
  return {
    ...actual,
    getAuthToken: () => mockGetAuthToken(),
  };
});

vi.mock("@hey-hey/ui-common/i18n", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/i18n")
  >("@hey-hey/ui-common/i18n");

  return {
    ...actual,
    compose: (template: string) => template,
  };
});

interface MockBreadcrumbItem {
  kind?: string;
  label: string;
  to?: string;
  type?: string;
  entityId?: string;
  isCurrent?: boolean;
}

vi.mock("@hey-hey/ui-common/components", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Breadcrumbs: ({ items }: { items: MockBreadcrumbItem[] }) => (
    <nav>
      {items.map((item, index) => {
        const label = item.label;
        if (item.to && !item.isCurrent) {
          return (
            <a
              key={`${item.entityId ?? label}-${index}`}
              href={item.to}
              data-kind={item.kind}
              data-testid={`breadcrumb-${item.type ?? "untyped"}`}
            >
              {label}
            </a>
          );
        }
        return (
          <span
            key={`${item.entityId ?? label}-${index}`}
            data-testid={`breadcrumb-${item.type ?? "untyped"}-current`}
          >
            {label}
          </span>
        );
      })}
    </nav>
  ),
}));

const buildDesignDoc = (
  overrides: Partial<DesignDocResponseDto> = {}
): DesignDocResponseDto =>
  ({
    id: "doc-current",
    name: "Current Doc",
    parentEntityId: null,
    parentEntityType: null,
    ...overrides,
  } as DesignDocResponseDto);

const renderBreadcrumbs = (designDoc: DesignDocResponseDto): void => {
  render(
    <MemoryRouter
      initialEntries={[`/projects/project-1/design-docs/${designDoc.id}`]}
    >
      <DesignDocBreadcrumbs
        organizationId="org-1"
        projectId="project-1"
        projectName="Project One"
        designDoc={designDoc}
      />
    </MemoryRouter>
  );
};

describe("DesignDocBreadcrumbs", () => {
  it("classifies an owning feature explicitly for the shared primitive", () => {
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "feature-parent",
        name: "Owning Feature",
        type: "FEATURE",
      },
    });
    renderBreadcrumbs(
      buildDesignDoc({
        parentEntityId: "feature-parent",
        parentEntityType: DesignDocParentEntityType.Task,
      })
    );
    expect(
      screen.getByRole("link", { name: /Owning Feature/ })
    ).toHaveAttribute("data-kind", "feature");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockReturnValue(null);
    mockUseProject.mockReturnValue({ data: null });
    mockUsePlan.mockReturnValue({ data: null });
    mockUseInitiative.mockReturnValue({ data: null });
    mockUseDesignDoc.mockReturnValue({ data: null });
    mockUseWorkItem.mockReturnValue({ workItem: null });
  });

  it("renders the Documents-list fallback when the doc has no parent", () => {
    renderBreadcrumbs(buildDesignDoc());

    const documentsLink = screen.getByRole("link", { name: /documents/i });
    expect(documentsLink).toHaveAttribute(
      "href",
      "/projects/project-1/design-docs"
    );
    expect(screen.getByText("Current Doc")).toBeInTheDocument();
  });

  it("renders a TASK ancestor with the resolved task name", () => {
    mockUseWorkItem.mockReturnValue({
      workItem: { id: "task-7", name: "Resolved Task Name" },
    });

    renderBreadcrumbs(
      buildDesignDoc({
        parentEntityId: "task-7",
        parentEntityType: DesignDocParentEntityType.Task,
      })
    );

    expect(screen.queryByText(/documents/i)).not.toBeInTheDocument();
    const taskLink = screen.getByRole("link", { name: /resolved task name/i });
    expect(taskLink).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/task-7"
    );
  });

  it("recursively walks DESIGN_DOC parents to render the full chain", () => {
    mockUseDesignDoc.mockImplementation(
      (_orgId: string | undefined, designDocId: string | undefined) => {
        if (designDocId === "doc-parent") {
          return {
            data: {
              id: "doc-parent",
              name: "Parent Doc",
              parentEntityId: "doc-grandparent",
              parentEntityType: DesignDocParentEntityType.DesignDoc,
            },
          };
        }
        if (designDocId === "doc-grandparent") {
          return {
            data: {
              id: "doc-grandparent",
              name: "Grandparent Doc",
              parentEntityId: null,
              parentEntityType: null,
            },
          };
        }
        return { data: null };
      }
    );

    renderBreadcrumbs(
      buildDesignDoc({
        parentEntityId: "doc-parent",
        parentEntityType: DesignDocParentEntityType.DesignDoc,
      })
    );

    const grandparentLink = screen.getByRole("link", {
      name: /grandparent doc/i,
    });
    expect(grandparentLink).toHaveAttribute(
      "href",
      "/projects/project-1/design-docs/doc-grandparent"
    );

    const parentLink = screen.getByRole("link", { name: /^Parent Doc/i });
    expect(parentLink).toHaveAttribute(
      "href",
      "/projects/project-1/design-docs/doc-parent"
    );

    expect(screen.getByText("Current Doc")).toBeInTheDocument();
    expect(screen.getByText(/documents/i)).toBeInTheDocument();
  });
});
