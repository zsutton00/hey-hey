import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceDtoStatusEnum, type ServiceDto } from "../../../api";
import { useServices } from "../../../data/hooks/useServices";
import { ServiceSelector } from "../ServiceSelector";

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: vi.fn(),
}));

const mockedUseServices = vi.mocked(useServices);

const service: ServiceDto = {
  id: "service-1",
  name: "UI Common",
  organizationId: "org-1",
  projectId: "project-1",
  status: ServiceDtoStatusEnum.Active,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
};

describe("ServiceSelector", () => {
  beforeEach(() => {
    mockedUseServices.mockReturnValue({
      services: [service],
      data: [service],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it("does not clear or deselect the final service when empty selection is disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ServiceSelector
        organizationId="org-1"
        projectId="project-1"
        value={[service.id]}
        onChange={onChange}
        allowEmptySelection={false}
        multiple
      />
    );

    expect(
      screen.queryByRole("button", { name: "Clear selection" })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "UI Common" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
