import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EntityGrid } from "../EntityGrid";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

interface TestItem {
  id: string;
  name: string;
}

describe("EntityGrid", () => {
  const testItems: TestItem[] = [
    { id: "1", name: "Item 1" },
    { id: "2", name: "Item 2" },
    { id: "3", name: "Item 3" },
  ];

  const renderItem = (item: TestItem) => <div>{item.name}</div>;
  const keyExtractor = (item: TestItem) => item.id;

  describe("rendering", () => {
    it("should render items using renderItem function", () => {
      render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
      expect(screen.getByText("Item 3")).toBeInTheDocument();
    });

    it("should call keyExtractor for each item", () => {
      const mockKeyExtractor = vi.fn(keyExtractor);

      render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={mockKeyExtractor}
        />
      );

      expect(mockKeyExtractor).toHaveBeenCalledTimes(3);
      expect(mockKeyExtractor).toHaveBeenCalledWith(testItems[0]);
      expect(mockKeyExtractor).toHaveBeenCalledWith(testItems[1]);
      expect(mockKeyExtractor).toHaveBeenCalledWith(testItems[2]);
    });
  });

  describe("loading state", () => {
    it("should show skeleton loaders when loading is true", () => {
      render(
        <EntityGrid
          items={testItems}
          loading={true}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      // Should not render items
      expect(screen.queryByText("Item 1")).not.toBeInTheDocument();

      // Should render 3 skeleton loaders
      const skeletons = document.querySelectorAll(".MuiSkeleton-root");
      expect(skeletons).toHaveLength(3);
    });

    it("should render items when loading is false", () => {
      render(
        <EntityGrid
          items={testItems}
          loading={false}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });

    it("should default loading to false", () => {
      render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when items array is empty", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          emptyMessage="No items found"
        />
      );

      expect(screen.getByText("No items found")).toBeInTheDocument();
    });

    it("should show default empty message when no custom message provided", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("common.noItemsFound")).toBeInTheDocument();
    });

    it("should show create button when showCreateButton is true", () => {
      const handleCreate = vi.fn();

      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showCreateButton={true}
          onCreateItem={handleCreate}
        />
      );

      const createButton = screen.getByRole("button");
      expect(createButton).toBeInTheDocument();
    });

    it("should not show create button by default", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should call onCreateItem when create button is clicked", () => {
      const handleCreate = vi.fn();

      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showCreateButton={true}
          onCreateItem={handleCreate}
        />
      );

      const createButton = screen.getByRole("button");
      fireEvent.click(createButton);

      expect(handleCreate).toHaveBeenCalledTimes(1);
    });

    it("should use custom create button label", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showCreateButton={true}
          onCreateItem={vi.fn()}
          createButtonLabel="Add New Task"
        />
      );

      expect(screen.getByText("Add New Task")).toBeInTheDocument();
    });

    it("should use default create button label when not provided", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showCreateButton={true}
          onCreateItem={vi.fn()}
        />
      );

      expect(screen.getByText("common.create")).toBeInTheDocument();
    });
  });

  describe("spacing", () => {
    it("should apply custom spacing", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          spacing={5}
        />
      );

      // Empty state should still render
      expect(screen.getByText("common.noItemsFound")).toBeInTheDocument();
    });

    it("should default spacing to 0", () => {
      render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      // Items should render normally
      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });
  });

  describe("variant", () => {
    it("should use list variant by default", () => {
      render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });

    it("should handle grid variant (future implementation)", () => {
      render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          variant="grid"
        />
      );

      // Currently falls through to list variant
      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });
  });

  describe("type safety", () => {
    it("should work with different item types", () => {
      interface CustomItem {
        uuid: string;
        title: string;
        count: number;
      }

      const customItems: CustomItem[] = [
        { uuid: "a", title: "First", count: 1 },
        { uuid: "b", title: "Second", count: 2 },
      ];

      render(
        <EntityGrid
          items={customItems}
          renderItem={(item) => (
            <div>
              {item.title} - {item.count}
            </div>
          )}
          keyExtractor={(item) => item.uuid}
        />
      );

      expect(screen.getByText("First - 1")).toBeInTheDocument();
      expect(screen.getByText("Second - 2")).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("should handle empty items array gracefully", () => {
      render(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("common.noItemsFound")).toBeInTheDocument();
    });

    it("should handle items becoming empty after initial render", () => {
      const { rerender } = render(
        <EntityGrid
          items={testItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();

      rerender(
        <EntityGrid
          items={[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
      expect(screen.getByText("common.noItemsFound")).toBeInTheDocument();
    });

    it("should handle loading state changing to false with empty items", () => {
      const { rerender } = render(
        <EntityGrid
          items={[]}
          loading={true}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      // Should show skeletons
      expect(document.querySelectorAll(".MuiSkeleton-root")).toHaveLength(3);

      rerender(
        <EntityGrid
          items={[]}
          loading={false}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
        />
      );

      // Should show empty state
      expect(screen.getByText("common.noItemsFound")).toBeInTheDocument();
    });
  });
});
