import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ServiceDto } from "../../api";
import { ServicesList } from "./ServicesList";

vi.mock("../../contexts", () => ({
  usePathService: () => ({
    organizationService: ({ serviceId }: { serviceId: string }) =>
      `/services/${serviceId}`,
  }),
}));
vi.mock("../Entity", async () => {
  const actual =
    await vi.importActual<typeof import("../Entity/adapters")>(
      "../Entity/adapters",
    );
  return {
    serviceAdapter: actual.serviceAdapter,
    EntityGrid: ({
      items,
      renderItem,
    }: {
      items: ServiceDto[];
      renderItem: (service: ServiceDto) => React.ReactNode;
    }) => <>{items.map(renderItem)}</>,
    EntityListItem: ({
      title,
      status,
      description,
    }: {
      title: string;
      status?: string;
      description?: string;
    }) => (
      <article>
        <h2>{title}</h2>
        <p>{description}</p>
        {status && <span>{status}</span>}
      </article>
    ),
  };
});

const service = (status: ServiceDto["status"]): ServiceDto => ({
  id: status,
  name: `${status} workspace`,
  description: "Code context",
  status,
  organizationId: "org",
  projectId: "project",
  serviceType: "other",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("ServicesList", () => {
  it("keeps archived labels passive and suppresses repeated Active badges", () => {
    render(
      <ServicesList
        services={[service("ACTIVE"), service("ARCHIVED")]}
        organizationId="org"
      />,
    );
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(
      screen.queryByText("ACTIVE", { exact: true }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Code context")).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
