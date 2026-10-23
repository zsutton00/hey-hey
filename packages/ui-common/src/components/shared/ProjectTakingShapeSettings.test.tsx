import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectMaturity,
  ProjectStatus,
  type ProjectResponseDto,
  type UpdateProjectDto,
} from "../../api";
import { ProjectTakingShapeSettings } from "./ProjectTakingShapeSettings";

const api = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock("../../clients/serviceClients", () => ({
  platformClient: { findOneProject: api.read, updateProject: api.update },
}));
vi.mock("../../data/hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
vi.mock("../../contexts", () => ({ usePathService: vi.fn() }));
const original: ProjectResponseDto = {
  id: "project",
  organizationId: "org",
  name: "Project",
  status: ProjectStatus.Active,
  hasEstablishedActivity: false,
  maturity: ProjectMaturity.Established,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectTakingShapeSettings organizationId="org" projectId="project" />
    </QueryClientProvider>,
  );
}

describe("ProjectTakingShapeSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.read.mockResolvedValue({ data: { data: original } });
    api.update.mockImplementation(
      async ({ updateProjectDto }: { updateProjectDto: UpdateProjectDto }) => ({
        data: { data: { ...original, ...updateProjectDto } },
      }),
    );
  });
  it("writes only deliberate changes and supports switching stages back and forth", async () => {
    const user = userEvent.setup();
    setup();
    const takingShape = await screen.findByRole("radio", {
      name: "Taking shape",
    });
    const established = screen.getByRole("radio", { name: "Established" });
    expect(established).toBeChecked();
    expect(takingShape).not.toBeChecked();
    expect(api.update).not.toHaveBeenCalled();
    await user.click(established);
    expect(api.update).not.toHaveBeenCalled();
    await user.click(takingShape);
    await waitFor(() => expect(takingShape).toBeEnabled());
    expect(takingShape).toBeChecked();
    expect(api.update).toHaveBeenLastCalledWith({
      organizationId: "org",
      projectId: "project",
      updateProjectDto: { maturity: ProjectMaturity.TakingShape },
    });
    await user.click(established);
    await waitFor(() => expect(established).toBeEnabled());
    expect(established).toBeChecked();
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenLastCalledWith({
      organizationId: "org",
      projectId: "project",
      updateProjectDto: { maturity: ProjectMaturity.Established },
    });
  });
  it("disables repeat changes while saving, restores the saved value after failure, and allows retry", async () => {
    let fail!: (error: Error) => void;
    api.update.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const user = userEvent.setup();
    setup();
    const control = await screen.findByRole("radio", {
      name: "Taking shape",
    });
    await user.click(control);
    await waitFor(() => expect(control).toBeDisabled());
    fireEvent.click(control);
    expect(api.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      fail(new Error("Save failed"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(control).not.toBeChecked();
    expect(control).toBeEnabled();
    await user.click(control);
    await waitFor(() => expect(control).toBeEnabled());
    expect(control).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
