import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MentionPopup } from "../MentionPopup";
import { ModalProvider } from "../../../contexts/ModalContext";
import { OrganizationProvider } from "../../../contexts/OrganizationContext";
import type { SearchEntity } from "../types";
import { INLINE_SEARCH_RESULTS_FRESHNESS } from "../inlineSearchResults";

let modalAvailable = true;
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();

vi.mock("../../../contexts/ModalContext", () => ({
  ModalProvider: ({ children }: { children: React.ReactNode }) => children,
  useModal: () =>
    modalAvailable
      ? {
          currentModal: null,
          openModal: mockOpenModal,
          closeModal: mockCloseModal,
        }
      : null,
}));

vi.mock("../../../contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: "test-user" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  }),
}));

vi.mock("../../../contexts/OrganizationContext", () => ({
  OrganizationProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useOrganization: () => ({
    currentOrganization: { id: "test-org-id", name: "Test Organization" },
  }),
}));

/**
 * Helper function to create mock SearchEntity data
 */
const createMockEntity = (
  overrides: Partial<SearchEntity> = {}
): SearchEntity => ({
  id: `entity-${Math.random()}`,
  type: "task",
  name: "Mock Entity",
  description: "Mock description",
  ...overrides,
});

/**
 * Helper function to create multiple mock entities
 */
const createMockEntities = (count: number, type = "task"): SearchEntity[] =>
  Array.from({ length: count }, (_, i) =>
    createMockEntity({
      id: `entity-${i + 1}`,
      type,
      name: `${type} ${i + 1}`,
      description: `Description for ${type} ${i + 1}`,
    })
  );

/**
 * Test wrapper that provides ModalProvider and OrganizationProvider
 */
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <OrganizationProvider
    organizations={[
      {
        id: "test-org-id",
        name: "Test Organization",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]}
    currentOrganizationId="test-org-id"
  >
    <ModalProvider>{children}</ModalProvider>
  </OrganizationProvider>
);

describe("MentionPopup - Advanced Search Integration", () => {
  const mockOnSelectEntity = vi.fn();
  const mockOnTypeFilterChange = vi.fn();

  const defaultProps = {
    query: "",
    results: [],
    selectedTypeFilter: "task",
    onTypeFilterChange: mockOnTypeFilterChange,
    onSelectEntity: mockOnSelectEntity,
    selectedIndex: -1,
    onSelectedIndexChange: vi.fn(),
    isLoading: false,
    resultsFreshness: INLINE_SEARCH_RESULTS_FRESHNESS.settled,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    modalAvailable = true;
    mockOpenModal.mockReset();
    mockCloseModal.mockReset();
  });

  describe("Advanced Search Button Visibility", () => {
    it("should show advanced search button when modal context is available", () => {
      render(
        <TestWrapper>
          <MentionPopup {...defaultProps} />
        </TestWrapper>
      );

      const advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      expect(advancedSearchButton).toBeInTheDocument();
      expect(advancedSearchButton).not.toBeDisabled();
    });

    it("should disable advanced search button when modal context is not available", () => {
      modalAvailable = false;
      render(<MentionPopup {...defaultProps} />);

      const advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      expect(advancedSearchButton).toBeInTheDocument();
      expect(advancedSearchButton).toBeDisabled();
    });
  });

  describe("Advanced Search Modal Integration", () => {
    it("should open modal with correct configuration when button clicked", async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper>
          <MentionPopup
            {...defaultProps}
            entityTypes={["task", "initiative"]}
          />
        </TestWrapper>
      );

      const advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      await user.click(advancedSearchButton);

      // Verify openModal was called with correct config
      expect(mockOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "advanced_search",
          organizationId: "test-org-id",
          defaultEntityTypes: ["task", "initiative"],
          allowMultiSelect: true,
        })
      );
    });

    it("should handle entity selection from modal callback", async () => {
      const user = userEvent.setup();
      let capturedOnSelect: ((entities: SearchEntity[]) => void) | null = null;

      mockOpenModal.mockImplementation((config) => {
        if (config.type === "advanced_search") {
          capturedOnSelect = config.onSelect;
        }
      });

      render(
        <TestWrapper>
          <MentionPopup {...defaultProps} />
        </TestWrapper>
      );

      const advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      await user.click(advancedSearchButton);

      // Simulate modal calling onSelect with entities
      const selectedEntities = createMockEntities(2, "task");
      capturedOnSelect?.(selectedEntities);

      // Verify each entity was passed to onSelectEntity
      expect(mockOnSelectEntity).toHaveBeenCalledTimes(2);
      expect(mockOnSelectEntity).toHaveBeenNthCalledWith(
        1,
        selectedEntities[0]
      );
      expect(mockOnSelectEntity).toHaveBeenNthCalledWith(
        2,
        selectedEntities[1]
      );
    });

    it("should work with different entity type configurations", async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <TestWrapper>
          <MentionPopup {...defaultProps} entityTypes={["task"]} />
        </TestWrapper>
      );

      let advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      await user.click(advancedSearchButton);

      expect(mockOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultEntityTypes: ["task"],
        })
      );

      mockOpenModal.mockClear();

      // Rerender with different entity types
      rerender(
        <TestWrapper>
          <MentionPopup
            {...defaultProps}
            entityTypes={["initiative", "design_doc"]}
          />
        </TestWrapper>
      );

      advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      await user.click(advancedSearchButton);

      expect(mockOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultEntityTypes: ["initiative", "design_doc"],
        })
      );
    });

    it("should not open modal when button is disabled", async () => {
      const user = userEvent.setup();
      modalAvailable = false;

      render(<MentionPopup {...defaultProps} />);

      const advancedSearchButton = screen.getByRole("button", {
        name: /advanced search/i,
      });
      expect(advancedSearchButton).toBeDisabled();

      // Modal should not open when button is disabled
      expect(mockOnSelectEntity).not.toHaveBeenCalled();
    });
  });
});
