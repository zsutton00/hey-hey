import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SelectField } from "./SelectField";
import type { FieldConfig } from "./types";
import { RepositoryFeatureEnrichmentChoice } from "../../../api";

// Mock useTranslation
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("SelectField", () => {
  const mockContext = {
    conversationId: "conv-123",
    projectId: "proj-123",
  };

  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it.each([
    ["Enrich details", RepositoryFeatureEnrichmentChoice.Enrich],
    ["Continue with this outline", RepositoryFeatureEnrichmentChoice.Skip],
  ])(
    "submits the explicit repository enrichment choice: %s",
    (label, choice) => {
      render(
        <SelectField
          config={{
            field: "repository_feature_enrichment_choice",
            type: "select",
            description: "Add more detail before importing?",
            required: true,
            selectOptions: [
              {
                label: "Enrich details",
                value: RepositoryFeatureEnrichmentChoice.Enrich,
              },
              {
                label: "Continue with this outline",
                value: RepositoryFeatureEnrichmentChoice.Skip,
              },
            ],
          }}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );
      expect(mockOnChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(mockOnChange).toHaveBeenCalledWith(choice);
    }
  );

  describe("Button Group Mode (< 5 options)", () => {
    const mockConfigSingle: FieldConfig = {
      field: "test-select",
      description: "Test single select field",
      type: "select",
      required: true,
      options: ["Option 1", "Option 2", "Option 3"],
      multiple: false,
    };

    const mockConfigMultiple: FieldConfig = {
      field: "test-multi-select",
      description: "Test multiple select field",
      type: "select",
      required: false,
      options: ["Option A", "Option B", "Option C", "Option D"],
      multiple: true,
    };

    it("should render button group when options < 5", () => {
      render(
        <SelectField
          config={mockConfigSingle}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      // Should render buttons instead of select dropdown
      expect(
        screen.getByRole("button", { name: "Option 1" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Option 2" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Option 3" })
      ).toBeInTheDocument();

      // Should not render select dropdown
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("should handle single select button clicks", () => {
      render(
        <SelectField
          config={mockConfigSingle}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const option1Button = screen.getByRole("button", { name: "Option 1" });
      fireEvent.click(option1Button);

      expect(mockOnChange).toHaveBeenCalledWith("Option 1");
    });

    it("should show selected button with contained variant for single select", () => {
      render(
        <SelectField
          config={mockConfigSingle}
          value="Option 2"
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const option2Button = screen.getByRole("button", { name: "Option 2" });
      expect(option2Button).toHaveClass("MuiButton-contained");
    });

    it("should handle multiple select button clicks", () => {
      render(
        <SelectField
          config={mockConfigMultiple}
          value={["Option A"]}
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const optionBButton = screen.getByRole("button", { name: "Option B" });
      fireEvent.click(optionBButton);

      expect(mockOnChange).toHaveBeenCalledWith(["Option A", "Option B"]);
    });

    it("should toggle off selected options in multiple select", () => {
      render(
        <SelectField
          config={mockConfigMultiple}
          value={["Option A", "Option B"]}
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const optionAButton = screen.getByRole("button", { name: "Option A" });
      fireEvent.click(optionAButton);

      expect(mockOnChange).toHaveBeenCalledWith(["Option B"]);
    });

    it("should show multiple selected buttons with contained variant", () => {
      render(
        <SelectField
          config={mockConfigMultiple}
          value={["Option A", "Option C"]}
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const optionAButton = screen.getByRole("button", { name: "Option A" });
      const optionCButton = screen.getByRole("button", { name: "Option C" });

      expect(optionAButton).toHaveClass("MuiButton-contained");
      expect(optionCButton).toHaveClass("MuiButton-contained");
    });

    it("should disable all buttons when disabled prop is true", () => {
      render(
        <SelectField
          config={mockConfigSingle}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={true}
          context={mockContext}
        />
      );

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button).toBeDisabled();
      });
    });
  });

  describe("Dropdown Mode (>= 5 options)", () => {
    const mockConfigManyOptions: FieldConfig = {
      field: "test-many-select",
      description: "Test select with many options",
      type: "select",
      required: false,
      options: [
        "Option 1",
        "Option 2",
        "Option 3",
        "Option 4",
        "Option 5",
        "Option 6",
      ],
      multiple: false,
    };

    const mockConfigManyMultiple: FieldConfig = {
      field: "test-many-multi-select",
      description: "Test multiple select with many options",
      type: "select",
      required: false,
      options: ["A", "B", "C", "D", "E", "F", "G"],
      multiple: true,
    };

    it("should render dropdown when options >= 5", () => {
      render(
        <SelectField
          config={mockConfigManyOptions}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      // Should render select dropdown
      expect(screen.getByRole("combobox")).toBeInTheDocument();

      // Should not render individual option buttons
      expect(
        screen.queryByRole("button", { name: "Option 1" })
      ).not.toBeInTheDocument();
    });

    it("should handle single select dropdown changes", () => {
      render(
        <SelectField
          config={mockConfigManyOptions}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const select = screen.getByRole("combobox");
      fireEvent.mouseDown(select);

      const option2 = screen.getByRole("option", { name: "Option 2" });
      fireEvent.click(option2);

      expect(mockOnChange).toHaveBeenCalledWith("Option 2");
    });

    it("should disable dropdown when disabled prop is true", () => {
      render(
        <SelectField
          config={mockConfigManyOptions}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={true}
          context={mockContext}
        />
      );

      const select = screen.getByRole("combobox");
      expect(select).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("Common Functionality", () => {
    const mockConfig: FieldConfig = {
      field: "test-field",
      description: "Test field description",
      type: "select",
      required: true,
      options: ["Option 1", "Option 2"],
    };

    it("should render field description", () => {
      render(
        <SelectField
          config={mockConfig}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      expect(screen.getByText("Test field description *")).toBeInTheDocument();
    });

    it("should show error message when error prop is provided", () => {
      render(
        <SelectField
          config={mockConfig}
          value=""
          onChange={mockOnChange}
          error="This field is required"
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      expect(screen.getByText("This field is required")).toBeInTheDocument();
    });

    it("should render with correct test id", () => {
      render(
        <SelectField
          config={mockConfig}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      expect(screen.getByTestId("select-field-test-field")).toBeInTheDocument();
    });

    it("should handle empty options array", () => {
      const configWithNoOptions: FieldConfig = {
        ...mockConfig,
        options: [],
      };

      render(
        <SelectField
          config={configWithNoOptions}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should handle undefined options", () => {
      const configWithUndefinedOptions: FieldConfig = {
        ...mockConfig,
        options: undefined,
      };

      render(
        <SelectField
          config={configWithUndefinedOptions}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      // Should render dropdown (fallback when no options)
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("should handle multiple select with empty initial value", () => {
      const multipleConfig: FieldConfig = {
        ...mockConfig,
        multiple: true,
      };

      render(
        <SelectField
          config={multipleConfig}
          value={undefined}
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const option1Button = screen.getByRole("button", { name: "Option 1" });
      fireEvent.click(option1Button);

      expect(mockOnChange).toHaveBeenCalledWith(["Option 1"]);
    });

    it("should handle multiple select with non-array initial value", () => {
      const multipleConfig: FieldConfig = {
        ...mockConfig,
        multiple: true,
      };

      render(
        <SelectField
          config={multipleConfig}
          value={"invalid-value" as unknown as string[]}
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      const option1Button = screen.getByRole("button", { name: "Option 1" });
      fireEvent.click(option1Button);

      expect(mockOnChange).toHaveBeenCalledWith(["Option 1"]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle exactly 4 options (button group)", () => {
      const configWith4Options: FieldConfig = {
        field: "test-4-options",
        description: "Test with 4 options",
        type: "select",
        options: ["A", "B", "C", "D"],
      };

      render(
        <SelectField
          config={configWith4Options}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      // Should render buttons (< 5 options)
      expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("should handle exactly 5 options (dropdown)", () => {
      const configWith5Options: FieldConfig = {
        field: "test-5-options",
        description: "Test with 5 options",
        type: "select",
        options: ["A", "B", "C", "D", "E"],
      };

      render(
        <SelectField
          config={configWith5Options}
          value=""
          onChange={mockOnChange}
          isSubmitted={false}
          disabled={false}
          context={mockContext}
        />
      );

      // Should render dropdown (>= 5 options)
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "A" })
      ).not.toBeInTheDocument();
    });
  });
});
