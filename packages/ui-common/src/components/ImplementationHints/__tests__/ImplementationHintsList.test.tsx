import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImplementationHintDto } from "../../../api";
import { ImplementationHintsList } from "../ImplementationHintsList";
import { useDeleteImplementationHint } from "../../../data";
import * as EntityModule from "../../Entity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "common.delete") return "Delete";
      if (key === "common.cancel") return "Cancel";
      return key;
    },
  }),
}));

vi.mock("../../../data", () => ({
  useDeleteImplementationHint: vi.fn(),
}));

const mockHint: ImplementationHintDto = {
  id: "hint-1",
  serviceId: "service-1",
  agentSessionId: "session-1",
  featureName: "Retry logic",
  description: "Document the retry backoff expectations.",
  hint: "Document the retry backoff expectations.",
  sourceType: "USER",
  versions: [],
  fileReferences: [],
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2023-01-01T00:00:00Z",
};

const mockUseDeleteImplementationHint = vi.mocked(useDeleteImplementationHint);

describe("ImplementationHintsList", () => {
  const mockDeleteImplementationHint = vi.fn();
  let implementationHintAdapterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    if (!global.ResizeObserver) {
      global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }

    vi.clearAllMocks();
    implementationHintAdapterSpy = vi.spyOn(
      EntityModule.implementationHintAdapter,
      "toEntityListItemProps"
    );
    mockUseDeleteImplementationHint.mockReturnValue({
      deleteImplementationHint: mockDeleteImplementationHint,
      isLoading: false,
      error: null,
    });
  });

  it("renders a stable test id for the list container", () => {
    render(
      <ImplementationHintsList
        organizationId="org-1"
        serviceId="service-1"
        hints={[mockHint]}
      />
    );

    expect(screen.getByTestId("implementation-hints-list")).toBeInTheDocument();
  });

  it("shows a confirmation dialog when delete is requested", async () => {
    render(
      <ImplementationHintsList
        organizationId="org-1"
        serviceId="service-1"
        hints={[mockHint]}
      />
    );

    fireEvent.click(screen.getByLabelText("Delete"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Delete" })).toBeInTheDocument();
    expect(
      screen.getByText('Are you sure you want to delete "Retry logic"?')
    ).toBeInTheDocument();
  });

  it("deletes the selected hint after confirmation", async () => {
    mockDeleteImplementationHint.mockResolvedValue(undefined);

    render(
      <ImplementationHintsList
        organizationId="org-1"
        serviceId="service-1"
        hints={[mockHint]}
      />
    );

    fireEvent.click(screen.getByLabelText("Delete"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(implementationHintAdapterSpy).toHaveBeenCalledWith(mockHint);
      expect(mockDeleteImplementationHint).toHaveBeenCalledWith(
        "hint-1",
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        })
      );
    });
  });

  it("notifies after a successful delete", async () => {
    const onHintDeleted = vi.fn();
    mockDeleteImplementationHint.mockImplementation(
      async (_hintId, callbacks) => {
        callbacks?.onSuccess?.();
      }
    );

    render(
      <ImplementationHintsList
        organizationId="org-1"
        serviceId="service-1"
        hints={[mockHint]}
        onHintDeleted={onHintDeleted}
      />
    );

    fireEvent.click(screen.getByLabelText("Delete"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onHintDeleted).toHaveBeenCalledWith(mockHint);
    });
  });
});
