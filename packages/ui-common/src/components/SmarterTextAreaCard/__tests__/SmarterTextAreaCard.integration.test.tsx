import { ThemeProvider, createTheme } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SmarterTextAreaCard } from "../SmarterTextAreaCard";
import type { WorkItemReferencesState } from "../../../data/hooks/useWorkItemReferences";

const testState = vi.hoisted(() => ({
  projectIds: { organizationId: "org-1", projectId: "project-1" } as {
    organizationId: string;
    projectId: string;
  } | null,
  references: {
    status: "ready" as const,
    references: [
      {
        id: "feature-search",
        name: "Feature Search",
        type: "FEATURE",
        parentTaskId: null,
      },
    ],
    isFetching: false as const,
  } satisfies WorkItemReferencesState,
  recordRecentSelection: vi.fn(),
}));

vi.mock("../../../data/hooks/useWorkItemReferences", () => ({
  useWorkItemReferences: () => testState.references,
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isReady: true }),
}));

vi.mock("../../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({ searchEntities: vi.fn() }),
}));

vi.mock("../../../data/hooks/useCachedConversationMentionOptions", () => ({
  useCachedConversationMentionOptions: () => [],
}));

vi.mock("../../../hooks/useEditorContext", () => ({
  useProjectIds: () => testState.projectIds,
}));

vi.mock("../slashCommands/RichSlashCommandPlugin", () => ({
  RichSlashCommandPlugin: () => null,
}));

vi.mock("../EntityDropPlugin", () => ({
  EntityDropPlugin: () => null,
}));

vi.mock("../recentMentionSelections", () => ({
  useRecentMentionSelections: () => ({
    selections: [],
    record: testState.recordRecentSelection,
  }),
}));

vi.mock("../MentionBadge", () => ({
  MentionBadgeInner: () => <span data-testid="mention-badge" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderCard(value = "Feature Search ") {
  const onChange = vi.fn();
  const rendered = render(
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <SmarterTextAreaCard
          value={value}
          onChange={onChange}
          saveStatus="draft"
          saveMode={null}
          hasUnsavedChanges={false}
        />
      </ThemeProvider>
    </MemoryRouter>
  );

  return { ...rendered, onChange };
}

describe("SmarterTextAreaCard feature-reference integration", () => {
  beforeEach(() => {
    Object.defineProperty(Node.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
    testState.projectIds = { organizationId: "org-1", projectId: "project-1" };
    testState.references = {
      status: "ready",
      references: [
        {
          id: "feature-search",
          name: "Feature Search",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    testState.recordRecentSelection.mockClear();
  });

  it("detects, converts, and continues editing in the mounted card", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCard();

    const match = await screen.findByTestId("feature-reference-match");
    expect(match).toHaveTextContent("Feature Search");

    fireEvent.click(match);
    fireEvent.click(await screen.findByTestId("feature-reference-candidate"));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "@[feature:feature-search|Feature Search] ",
        { kind: "literal" }
      )
    );
    expect(testState.recordRecentSelection).toHaveBeenCalledTimes(1);

    const input = screen.getByTestId("smarter-textarea-input");
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "continued");

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "@[feature:feature-search|Feature Search] continued",
        { kind: "literal" }
      )
    );
  });

  it("unwraps the transient match when reference data becomes unavailable", async () => {
    const rendered = renderCard();

    await screen.findByTestId("feature-reference-match");

    testState.references = {
      status: "loading",
      references: [],
      isFetching: true,
    };
    rendered.rerender(
      <MemoryRouter>
        <ThemeProvider theme={createTheme()}>
          <SmarterTextAreaCard
            value="Feature Search "
            onChange={rendered.onChange}
            saveStatus="draft"
            saveMode={null}
            hasUnsavedChanges={false}
          />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("feature-reference-match")
      ).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("smarter-textarea-input")).toHaveTextContent(
      "Feature Search"
    );
  });
});
