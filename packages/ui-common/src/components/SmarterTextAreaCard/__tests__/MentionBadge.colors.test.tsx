import { cleanup, render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionBadgeInner } from "../MentionBadge";
import { MentionEditorContext } from "../EditorContext";
import { EntityIcon } from "../../Entity/EntityIcon";

const registry = vi.hoisted(() => ({
  definition: {
    key: "CUSTOM",
    name: "Custom",
    role: "work-item",
    sections: [],
    allowedStatuses: [],
    iconKey: "star",
    colorKey: "secondary",
  },
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    isFetched: true,
    error: null,
    workItemTypeDefinition: registry.definition,
    workItemTypeSummary: {
      definition: registry.definition,
      effectiveSource: "PROJECT_CUSTOM",
    },
  }),
  useMentionWorkItemTypeKey: () => ({ typeKey: "CUSTOM", isResolved: true }),
}));
vi.mock("../EntityHoverCard", () => ({ EntityHoverCard: () => null }));
vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) =>
    children,
  resolveEntityTypeConfig: () => undefined,
}));

afterEach(cleanup);

describe("registry custom color across identity consumers", () => {
  it.each(["light", "dark"] as const)(
    "shares icon background and mention accent in %s mode",
    (mode) => {
      const theme = createTheme({ palette: { mode } });
      render(
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <MentionEditorContext.Provider
              value={{
                organizationId: "org",
                projectId: "project",
                navigate: vi.fn(),
              }}
            >
              <MentionBadgeInner
                mention={{
                  entityId: "item",
                  entityType: "CUSTOM",
                  entityName: "Example",
                }}
              />
              <EntityIcon
                entityType="task"
                workItemIcon={{
                  typeKey: "CUSTOM",
                  definition: {
                    key: "CUSTOM",
                    name: "Custom",
                    role: "work-item",
                    sections: [],
                    allowedStatuses: [],
                    iconKey: "star",
                    colorKey: "secondary",
                  },
                  effectiveSource: "PROJECT_CUSTOM",
                }}
                data-testid="color-icon"
              />
            </MentionEditorContext.Provider>
          </MemoryRouter>
        </ThemeProvider>
      );
      expect(screen.getByTestId("mention-badge")).toHaveStyle({
        color: theme.palette.secondary.main,
      });
      expect(screen.getByTestId("color-icon")).toHaveStyle({
        backgroundColor: theme.palette.secondary.main,
        color: theme.palette.secondary.contrastText,
      });
    }
  );
});
