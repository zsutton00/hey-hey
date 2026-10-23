import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { IntegrationResponseDto } from "../../../../api";
import { IntegrationsField } from "../IntegrationsField";
import type { FieldConfig } from "../types";

const mockUseIntegrationService = vi.fn();

vi.mock("../../../../hooks/useIntegrationService", () => ({
  useIntegrationService: () => mockUseIntegrationService(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );

  return {
    ...actual,
    useParams: () => ({ projectId: "test-project" }),
  };
});

vi.mock(
  "../../../../pages/Integrations/components/CreateIntegrationDialog",
  () => ({
    CreateIntegrationDialog: ({
      open,
      selectedType,
    }: {
      open: boolean;
      selectedType: string;
    }) => {
      if (!open) {
        return null;
      }

      const integrationName =
        selectedType === "GITHUB" ? "GitHub" : selectedType.toUpperCase();

      return (
        <div role="dialog">
          <h2>Configure {integrationName} Integration</h2>
          <label htmlFor="personal-access-token">Personal Access Token</label>
          <input id="personal-access-token" />
          <label htmlFor="organization-username">Organization/Username</label>
          <input id="organization-username" />
        </div>
      );
    },
  })
);

vi.mock(
  "../../../../pages/Integrations/components/EditIntegrationDialog",
  () => ({
    EditIntegrationDialog: ({ open }: { open: boolean }) =>
      open ? <div role="dialog">Edit Integration</div> : null,
  })
);

const buildBaseService = () => ({
  integrations: [] as IntegrationResponseDto[],
  loading: false,
  error: null as string | null,
  getAllIntegrations: vi.fn().mockResolvedValue(undefined),
  getIntegration: vi.fn().mockResolvedValue({} as IntegrationResponseDto),
  createIntegration: vi.fn().mockResolvedValue({} as IntegrationResponseDto),
  updateIntegration: vi.fn().mockResolvedValue({} as IntegrationResponseDto),
  deleteIntegration: vi.fn().mockResolvedValue(undefined),
  testExistingConnection: vi.fn().mockResolvedValue({ jobId: "test-job" }),
});

type IntegrationServiceMock = ReturnType<typeof buildBaseService>;

const createServiceMock = (
  overrides: Partial<IntegrationServiceMock> = {}
): IntegrationServiceMock => ({
  ...buildBaseService(),
  ...overrides,
});

const setupServiceMock = (overrides: Partial<IntegrationServiceMock> = {}) => {
  const service = createServiceMock(overrides);
  mockUseIntegrationService.mockReturnValue(service);
  return service;
};

describe("IntegrationsField", () => {
  const mockConfig: FieldConfig = {
    field: "integrations",
    description: "Configure your integrations",
    type: "integrations",
    required: false,
  };

  const mockOnChange = vi.fn();

  const renderIntegrationsField = (
    props: Partial<Parameters<typeof IntegrationsField>[0]> = {}
  ) => {
    render(
      <MemoryRouter>
        <IntegrationsField
          config={mockConfig}
          value={undefined}
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={{
            conversationId: "conversation-1",
            projectId: "test-project",
            organizationId: "org-1",
          }}
          {...props}
        />
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    mockOnChange.mockClear();
    mockUseIntegrationService.mockReset();
    setupServiceMock();
  });

  it("should render the integrations field", () => {
    renderIntegrationsField();

    expect(screen.getByText("Configure your integrations")).toBeInTheDocument();
  });

  it("should show available integrations when none are configured", () => {
    renderIntegrationsField();

    expect(screen.getByText("Add New Integration")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect your GitHub repositories for issue tracking and code management. Uses advanced API-driven configuration."
      )
    ).toBeInTheDocument();
  });

  it("should show search functionality", () => {
    renderIntegrationsField();

    const searchInput = screen.getByPlaceholderText("Search integrations...");
    expect(searchInput).toBeInTheDocument();
  });

  it("should filter integrations based on search term", async () => {
    renderIntegrationsField();

    const searchInput = screen.getByPlaceholderText("Search integrations...");

    // Search functionality should be present
    expect(searchInput).toBeInTheDocument();

    // Search for something that doesn't match
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Connect your GitHub repositories for issue tracking and code management"
        )
      ).not.toBeInTheDocument();
    });
  });

  it("should show configured integrations when value is provided", () => {
    const configuredIntegrations: IntegrationResponseDto[] = [
      {
        id: "1",
        name: "GitHub",
        type: "GITHUB",
        description: "GitHub integration",
        organizationId: "org-1",
        projectId: "test-project",
        state: "ACTIVE",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
        config: {
          accessToken: "ghp_test",
          organization: "test-org",
          repositories: "repo1, repo2",
        },
      } as unknown as IntegrationResponseDto,
      {
        id: "2",
        name: "Jira",
        type: "JIRA",
        description: "Jira integration",
        organizationId: "org-1",
        projectId: "test-project",
        state: "ACTIVE",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
        config: {
          serverUrl: "https://example.atlassian.net",
          email: "user@example.com",
          apiToken: "token",
        },
      } as unknown as IntegrationResponseDto,
    ];

    setupServiceMock({ integrations: configuredIntegrations });

    renderIntegrationsField();

    expect(screen.getByText("Existing Integrations")).toBeInTheDocument();
    expect(
      screen.getByText("All available integrations have been configured.")
    ).toBeInTheDocument();
  });

  it("should show edit and delete buttons for configured integrations", () => {
    const configuredIntegrations: IntegrationResponseDto[] = [
      {
        id: "1",
        name: "GitHub",
        type: "GITHUB",
        description: "GitHub integration",
        organizationId: "org-1",
        projectId: "test-project",
        state: "ACTIVE",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
        config: {
          accessToken: "ghp_test",
          organization: "test-org",
        },
      } as unknown as IntegrationResponseDto,
    ];

    setupServiceMock({ integrations: configuredIntegrations });

    renderIntegrationsField();

    // Edit and delete buttons should be present (by icon data-testid)
    expect(screen.getByTestId("EditIcon")).toBeInTheDocument();
    expect(screen.getByTestId("DeleteIcon")).toBeInTheDocument();
  });

  it("should be disabled when disabled prop is true", () => {
    renderIntegrationsField({ disabled: true });

    const searchInput = screen.getByPlaceholderText("Search integrations...");
    const availableCards = screen.getAllByRole("button");

    expect(searchInput).toBeDisabled();
    availableCards.forEach((card) => {
      expect(card).toBeDisabled();
    });
  });

  it("should handle invalid JSON gracefully", () => {
    renderIntegrationsField({ value: "invalid json" });

    // Should still render without crashing
    expect(screen.getByText("Add New Integration")).toBeInTheDocument();
  });
});
