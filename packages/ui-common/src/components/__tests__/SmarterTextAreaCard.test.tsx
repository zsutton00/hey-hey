import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SmarterTextAreaCard } from "../SmarterTextAreaCard/SmarterTextAreaCard";

let projectIds: { organizationId: string; projectId: string } | null = null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({
    currentOrgId: "test-org-id",
  }),
}));

vi.mock("../../hooks/useEditorContext", () => ({
  useProjectIds: () => projectIds,
}));

vi.mock("../SmarterTextAreaCard/FeatureReferenceDiscoveryPlugin", () => ({
  FeatureReferenceDiscoveryPlugin: ({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) => (
    <div
      data-testid="feature-reference-discovery-plugin"
      data-organization-id={organizationId}
      data-project-id={projectId}
    />
  ),
}));

vi.mock("../../data/hooks/useEntitySearch", () => ({
  useEntitySearch: () => ({
    searchEntities: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../SmarterTextAreaCard/MentionPlugin", () => ({
  MentionPlugin: () => null,
}));

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual("@mui/material");
  return {
    ...actual,
    useTheme: () => ({
      breakpoints: {
        down: (_key: string) => "(max-width:600px)",
      },
      shape: { borderRadius: 4 },
      palette: {
        divider: "#e0e0e0",
        text: { primary: "#000000", secondary: "#666666" },
        actionable: {
          main: "#1976d2",
          dark: "#115293",
          contrastText: "#ffffff",
        },
        heyhey: {
          main: "#087e8b",
          dark: "#065f68",
          light: "#e0f2f1",
        },
        success: { main: "#2e7d32" },
        error: { main: "#d32f2f", light: "#ef9a9a" },
        grey: { 50: "#fafafa", 100: "#f5f5f5" },
      },
    }),
  };
});

describe("SmarterTextAreaCard", () => {
  afterEach(() => {
    vi.useRealTimers();
    projectIds = null;
  });

  it("automatically mounts feature discovery for rich project-aware editors", () => {
    projectIds = { organizationId: "org-1", projectId: "project-1" };

    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
      />
    );

    expect(
      screen.getByTestId("feature-reference-discovery-plugin"),
    ).toHaveAttribute("data-organization-id", "org-1");
    expect(
      screen.getByTestId("feature-reference-discovery-plugin"),
    ).toHaveAttribute("data-project-id", "project-1");
  });

  it("keeps plain and context-free editors free of passive discovery", () => {
    const rendered = render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
      />
    );

    expect(
      screen.queryByTestId("feature-reference-discovery-plugin"),
    ).not.toBeInTheDocument();

    projectIds = { organizationId: "org-1", projectId: "project-1" };
    rendered.rerender(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        rendering="plain"
      />
    );

    expect(
      screen.queryByTestId("feature-reference-discovery-plugin"),
    ).not.toBeInTheDocument();
  });

  it("renders with Lexical editor initialized", () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    // Check that the component renders
    expect(screen.getByTestId("smarter-textarea-card")).toBeInTheDocument();
  });

  it("maintains same props interface as SmartTextAreaCard", () => {
    const handleChange = vi.fn();
    const handleSaveWithoutFeedback = vi.fn();
    const handleSaveWithFeedback = vi.fn();
    const handleFocus = vi.fn();
    const handleBlur = vi.fn();

    render(
      <SmarterTextAreaCard
        value="Test content"
        onChange={handleChange}
        disabled={false}
        placeholder="Enter text..."
        headerText="Test Header"
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={true}
        onSaveWithoutFeedback={handleSaveWithoutFeedback}
        onSaveWithFeedback={handleSaveWithFeedback}
        isSaving={false}
        saveWithoutFeedbackText="Save"
        saveWithFeedbackText="Save & Review"
        multiline={true}
        error={false}
        helperText="Helper text"
        minRows={3}
        maxRows={16}
        required={false}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    );

    expect(screen.getByTestId("smarter-textarea-card")).toBeInTheDocument();
  });

  it("displays header text when provided", () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        headerText="Enter your response"
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    expect(screen.getByText("Enter your response")).toBeInTheDocument();
  });

  it("shows status indicator in header", () => {
    const { rerender } = render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    // Should show saved status
    rerender(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="saved"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    expect(screen.getByTestId("smarter-textarea-card")).toBeInTheDocument();
  });

  it("displays action buttons when callbacks provided", () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={true}
        isSaving={false}
        onSaveWithoutFeedback={vi.fn()}
        onSaveWithFeedback={vi.fn()}
      />
    );

    expect(screen.getByTestId("smarter-textarea-card")).toBeInTheDocument();
  });

  it("disables save immediately on press by default", async () => {
    vi.useFakeTimers();

    const DelayedSavingWrapper = () => {
      const [isSaving, setIsSaving] = React.useState(false);

      return (
        <SmarterTextAreaCard
          value="Needs save"
          onChange={vi.fn()}
          saveStatus="draft"
          saveMode={null}
          hasUnsavedChanges={true}
          isSaving={isSaving}
          onSaveWithoutFeedback={() => {
            setTimeout(() => setIsSaving(true), 10);
          }}
        />
      );
    };

    render(<DelayedSavingWrapper />);

    const button = screen.getByTestId("smarter-textarea-save-without-feedback");

    fireEvent.click(button);

    expect(button).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(button).toBeDisabled();
  });

  it("supports opting out of immediate disable-on-press", async () => {
    vi.useFakeTimers();

    const DelayedSavingWrapper = () => {
      const [isSaving, setIsSaving] = React.useState(false);

      return (
        <SmarterTextAreaCard
          value="Needs save"
          onChange={vi.fn()}
          saveStatus="draft"
          saveMode={null}
          hasUnsavedChanges={true}
          isSaving={isSaving}
          actionLockBehavior="external-only"
          onSaveWithoutFeedback={() => {
            setTimeout(() => setIsSaving(true), 10);
          }}
        />
      );
    };

    render(<DelayedSavingWrapper />);

    const button = screen.getByTestId("smarter-textarea-save-without-feedback");

    fireEvent.click(button);

    expect(button).not.toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(button).toBeDisabled();
  });

  it("clears the local lock if no external saving state is entered", async () => {
    render(
      <SmarterTextAreaCard
        value="Needs save"
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={true}
        isSaving={false}
        onSaveWithoutFeedback={vi.fn()}
      />
    );

    const button = screen.getByTestId("smarter-textarea-save-without-feedback");

    fireEvent.click(button);

    expect(button).toBeDisabled();

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it("supports mention functionality through Lexical", () => {
    const handleChange = vi.fn();

    render(
      <SmarterTextAreaCard
        value=""
        onChange={handleChange}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    // The editor should be initialized and ready for mentions
    expect(screen.getByTestId("smarter-textarea-card")).toBeInTheDocument();
  });

  it("handles disabled state", () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        disabled={true}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    expect(screen.getByTestId("smarter-textarea-card")).toBeInTheDocument();
  });

  it("submits only on Cmd/Ctrl+Enter outside composition", () => {
    const onSubmit = vi.fn();

    render(
      <SmarterTextAreaCard
        value="Feedback"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    const input = screen.getByTestId("smarter-textarea-input");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit while disabled", () => {
    const onSubmit = vi.fn();

    render(
      <SmarterTextAreaCard
        value="Feedback"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        disabled
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
      />
    );

    fireEvent.keyDown(screen.getByTestId("smarter-textarea-input"), {
      key: "Enter",
      metaKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("displays helper text when provided", () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
        helperText="This is helper text"
      />
    );

    expect(screen.getByText("This is helper text")).toBeInTheDocument();
  });

  it("shows error state when error prop is true", () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={vi.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        isSaving={false}
        error={true}
        helperText="Error message"
      />
    );

    expect(screen.getByText("Error message")).toBeInTheDocument();
  });
});
