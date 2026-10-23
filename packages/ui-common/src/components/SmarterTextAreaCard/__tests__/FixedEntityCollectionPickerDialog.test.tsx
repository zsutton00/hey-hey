import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesignDocTemplate,
  EntityType,
  ServiceDtoStatusEnum,
  type DesignDocResponseDto,
  type ServiceDto,
} from "../../../api";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import {
  FixedEntityCollectionPickerDialog,
  prepareFixedEntityRows,
} from "../slashCommands/FixedEntityCollectionPickerDialog";

const openPreview = vi.fn();

const service = (status = ServiceDtoStatusEnum.Active): ServiceDto => ({
  id: "service-1",
  name: "API service",
  description: "Detailed service description",
  organizationId: "org-1",
  projectId: "project-1",
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const namedService = (
  id: string,
  name: string,
  status = ServiceDtoStatusEnum.Active,
): ServiceDto => ({
  ...service(status),
  id,
  name,
  createdAt: `2026-01-${id.padStart(2, "0")}T00:00:00.000Z`,
});

const designDoc = (status: string): DesignDocResponseDto => ({
  id: `doc-${status.toLowerCase()}`,
  name: `${status} design`,
  template: DesignDocTemplate.Classic,
  status,
  organizationId: "org-1",
  projectId: "project-1",
  tags: [],
  summary: "Detailed design summary",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const hookData = vi.hoisted(() => ({
  services: [] as ServiceDto[],
  designDocs: [] as DesignDocResponseDto[],
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({
    services: hookData.services,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useDesignDocs", () => ({
  useDesignDocs: () => ({
    designDocs: hookData.designDocs,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));
vi.mock("../EntityHoverCard", () => ({ EntityHoverCard: () => null }));

describe("FixedEntityCollectionPickerDialog", () => {
  beforeEach(() => {
    hookData.services = [service()];
    hookData.designDocs = [designDoc("ACTIVE")];
    openPreview.mockReset();
  });

  it("filters archived records before totals and page slicing, then sorts deterministically", () => {
    const activePlans = Array.from({ length: 21 }, (_value, index) =>
      namedService(
        String(index + 1),
        index < 2 ? "Same name" : `Plan ${index + 1}`,
      ),
    );
    const prepared = prepareFixedEntityRows(
      {
        kind: "service",
        items: [
          namedService("99", "Archived", ServiceDtoStatusEnum.Archived),
          ...activePlans,
        ],
      },
      {
        organizationId: "org-1",
        projectId: "project-1",
        filter: "",
        sort: "name-asc",
        page: 2,
        pageSize: 20,
      },
    );

    expect(prepared.totalItems).toBe(21);
    expect(prepared.totalPages).toBe(2);
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows.some((row) => row.entityName === "Archived")).toBe(
      false,
    );

    const sameNames = prepareFixedEntityRows(
      { kind: "service", items: activePlans.slice(0, 2).reverse() },
      {
        organizationId: "org-1",
        projectId: "project-1",
        filter: "same",
        sort: "name-asc",
        page: 1,
        pageSize: 20,
      },
    );
    expect(sameNames.rows.map((row) => row.entityId)).toEqual(["1", "2"]);
  });

  it("sorts canonical plans with absent creation dates deterministically", () => {
    const undated = { ...namedService("2", "Undated"), createdAt: undefined };
    const prepared = prepareFixedEntityRows(
      { kind: "service", items: [undated, namedService("1", "Dated")] },
      {
        organizationId: "org-1",
        projectId: "project-1",
        filter: "",
        sort: "created-asc",
        page: 1,
        pageSize: 20,
      },
    );
    expect(prepared.rows.map((row) => row.entityName)).toEqual([
      "Dated",
      "Undated",
    ]);
  });

  it("removes archived Services and Design Docs from their native collections", () => {
    expect(
      prepareFixedEntityRows(
        { kind: "service", items: [service(ServiceDtoStatusEnum.Archived)] },
        {
          organizationId: "org-1",
          projectId: "project-1",
          filter: "",
          sort: "name-asc",
          page: 1,
          pageSize: 20,
        },
      ).totalItems,
    ).toBe(0);
    expect(
      prepareFixedEntityRows(
        { kind: "design-doc", items: [designDoc("ARCHIVED")] },
        {
          organizationId: "org-1",
          projectId: "project-1",
          filter: "",
          sort: "name-asc",
          page: 1,
          pageSize: 20,
        },
      ).totalItems,
    ).toBe(0);
  });

  it("keeps Service hover-only because the capability registry has no Preview", () => {
    renderPicker({ kind: "service", entityType: EntityType.Service });
    expect(screen.getByText("API service")).toBeVisible();
    expect(screen.queryByText("Detailed service description")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Preview API service" }),
    ).toBeNull();
  });

  it("uses the same title-and-type row treatment for Design Docs", () => {
    renderPicker({ kind: "design-doc", entityType: EntityType.DesignDoc });

    expect(screen.getByText("ACTIVE design")).toBeVisible();
    expect(screen.queryByText("Detailed design summary")).toBeNull();
  });
});

const renderPicker = (
  target:
    | { kind: "service"; entityType: typeof EntityType.Service }
    | { kind: "design-doc"; entityType: typeof EntityType.DesignDoc },
  onSelect = vi.fn(),
) =>
  render(
    <PreviewHostProvider host={{ openPreview }}>
      <FixedEntityCollectionPickerDialog
        organizationId="org-1"
        projectId="project-1"
        target={target}
        onClose={vi.fn()}
        onSelect={onSelect}
      />
    </PreviewHostProvider>,
  );
