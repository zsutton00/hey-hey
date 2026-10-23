import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceRepoBinding } from "../../api";

const mocks = vi.hoisted(() => ({
  api: {
    listRepos: vi.fn(),
    pickDirectory: vi.fn(),
    setRepo: vi.fn(),
  },
  refetch: vi.fn(),
  localBindings: {
    status: "empty" as "empty" | "error",
    bindings: [] as ServiceRepoBinding[],
    bindingsByServiceId: {} as Record<string, ServiceRepoBinding>,
    error: undefined as Error | undefined,
    refetch: vi.fn(),
    markStale: vi.fn(),
  },
}));

vi.mock("../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: () => mocks.localBindings,
}));

vi.mock("../AgentSession/runtime/directoryBindingApi", () => ({
  createDirectoryBindingApi: () => mocks.api,
  resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
}));

import { ServiceDirectoryBindingControl } from "./ServiceDirectoryBindingControl";

const binding: ServiceRepoBinding = {
  serviceId: "service-1",
  repositoryPath: "/workspace/ui",
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const setCompact = (matches: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

describe("ServiceDirectoryBindingControl", () => {
  beforeEach(() => {
    mocks.api.listRepos.mockReset().mockResolvedValue({
      machineId: "machine-1",
      bindings: [],
    });
    mocks.api.pickDirectory.mockReset();
    mocks.api.setRepo.mockReset();
    mocks.localBindings.refetch.mockReset().mockResolvedValue([binding]);
    mocks.localBindings.status = "empty";
    mocks.localBindings.error = undefined;
    setCompact(false);
    mocks.localBindings.bindings = [];
    mocks.localBindings.bindingsByServiceId = {};
  });

  it("writes the exact Service binding and refreshes after a directory is picked", async () => {
    mocks.api.pickDirectory.mockResolvedValue({
      status: "selected",
      machineId: "machine-1",
      repositoryPath: "/workspace/ui",
    });
    mocks.api.setRepo.mockResolvedValue(binding);

    render(<ServiceDirectoryBindingControl serviceId="service-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Link directory" }));

    await waitFor(() => {
      expect(mocks.api.pickDirectory).toHaveBeenCalledWith("machine-1");
      expect(mocks.api.setRepo).toHaveBeenCalledWith(
        "service-1",
        "machine-1",
        "/workspace/ui",
      );
      expect(mocks.localBindings.refetch).toHaveBeenCalledOnce();
    });
  });

  it("keeps directory action labels on one line", () => {
    mocks.localBindings.bindingsByServiceId = { "service-1": binding };

    render(<ServiceDirectoryBindingControl serviceId="service-1" />);

    expect(
      screen.getByRole("button", { name: "Update directory" }),
    ).toHaveStyle({ whiteSpace: "nowrap" });
  });

  it("reports cancellation without writing a binding", async () => {
    mocks.api.pickDirectory.mockResolvedValue({
      status: "cancelled",
      machineId: "machine-1",
    });

    render(<ServiceDirectoryBindingControl serviceId="service-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Link directory" }));

    expect(
      await screen.findByText(
        "Directory linking was cancelled. No directory was linked.",
      ),
    ).toBeInTheDocument();
    expect(mocks.api.setRepo).not.toHaveBeenCalled();
    expect(mocks.localBindings.refetch).not.toHaveBeenCalled();
  });

  it("does not bind a directory when the selected machine is not connected", async () => {
    mocks.api.listRepos.mockResolvedValue({
      machineId: "machine-1",
      bindings: [],
    });

    render(
      <ServiceDirectoryBindingControl
        serviceId="service-1"
        machineId="machine-2"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Link directory" }));

    expect(
      await screen.findByText(
        "The selected CLI machine is not the machine connected to this browser. Select the CLI running on this computer, then try linking again.",
      ),
    ).toBeInTheDocument();
    expect(mocks.api.pickDirectory).not.toHaveBeenCalled();
    expect(mocks.api.setRepo).not.toHaveBeenCalled();
  });

  it("surfaces a directory write failure", async () => {
    mocks.api.pickDirectory.mockResolvedValue({
      status: "selected",
      machineId: "machine-1",
      repositoryPath: "/workspace/ui",
    });
    mocks.api.setRepo.mockRejectedValue(new Error("Permission denied"));

    render(<ServiceDirectoryBindingControl serviceId="service-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Link directory" }));

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(mocks.localBindings.refetch).not.toHaveBeenCalled();
  });

  it("shows one short line and no link controls on compact screens when the CLI cannot be read", () => {
    setCompact(true);
    mocks.localBindings.status = "error";
    mocks.localBindings.error = new Error("fetch failed");

    render(<ServiceDirectoryBindingControl serviceId="service-1" />);

    expect(
      screen.getByText(
        "A directory can only be linked from the computer running the CLI.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps link controls with a short warning on larger screens when the CLI cannot be read", () => {
    mocks.localBindings.status = "error";
    mocks.localBindings.error = new Error("fetch failed");

    render(<ServiceDirectoryBindingControl serviceId="service-1" />);

    expect(
      screen.getByText(/Could not reach the local CLI on this computer/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Link directory" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});
