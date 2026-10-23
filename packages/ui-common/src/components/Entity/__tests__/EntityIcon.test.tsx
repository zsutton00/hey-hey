import { createTheme, ThemeProvider } from "@mui/material/styles";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import { EntityIcon } from "../EntityIcon";

const definition = (
  key: string,
  iconKey: WorkItemTypeDefinitionDto["iconKey"]
): WorkItemTypeDefinitionDto => ({
  key,
  name: key,
  sections: [],
  allowedStatuses: [],
  iconKey,
});

afterEach(cleanup);

describe("EntityIcon registry-backed work-item presentation", () => {
  it.each([
    ["mockup", "design", "0 0 20 20"],
    ["decision", "decision", "0 0 256 256"],
  ])("renders the registered %s glyph", (typeKey, iconKey, viewBox) => {
    render(
      <EntityIcon
        entityType="task"
        workItemIcon={{ typeKey, definition: definition(typeKey, iconKey) }}
        data-testid="registry-work-item-icon"
      />
    );

    expect(
      screen.getByTestId("registry-work-item-icon").querySelector("svg")
    ).toHaveAttribute("viewBox", viewBox);
  });

  it("renders a matching Mockup definition with its supplied glyph and red color", () => {
    render(
      <EntityIcon
        entityType="task"
        workItemIcon={{
          typeKey: "mockup",
          definition: definition("mockup", "task"),
        }}
        data-testid="registry-work-item-icon"
      />
    );

    expect(screen.getByTestId("registry-work-item-icon")).toHaveStyle({
      backgroundColor: "rgb(211, 47, 47)",
      color: "rgb(255, 255, 255)",
    });
    expect(
      screen.getByTestId("registry-work-item-icon").querySelector("svg")
    ).toHaveAttribute("viewBox", "0 0 20 20");
  });

  it("renders the Mockup identity with the red semantic color", () => {
    render(<EntityIcon entityType="mockup" data-testid="mockup-icon" />);

    expect(screen.getByTestId("mockup-icon")).toHaveStyle({
      backgroundColor: "rgb(211, 47, 47)",
      color: "rgb(255, 255, 255)",
    });
  });

  it("uses only the generic task glyph when the registry definition does not match", () => {
    render(
      <EntityIcon
        entityType="task"
        workItemIcon={{
          typeKey: "decision",
          definition: definition("mockup", "decision"),
        }}
        data-testid="registry-work-item-icon"
      />
    );

    expect(
      screen.getByTestId("registry-work-item-icon").querySelector("svg")
    ).toHaveAttribute("viewBox", "0 0 24 24");
  });
});

describe("custom color contrast in both themes", () => {
  it.each(["light", "dark"] as const)(
    "uses the selected theme main and contrastText in %s mode",
    (mode) => {
      const theme = createTheme({ palette: { mode } });
      render(
        <ThemeProvider theme={theme}>
          <EntityIcon
            entityType="task"
            workItemIcon={{
              typeKey: "CUSTOM",
              definition: {
                ...definition("CUSTOM", "shield"),
                colorKey: "secondary",
              },
              effectiveSource: "PROJECT_CUSTOM",
            }}
            data-testid="custom-color-icon"
          />
        </ThemeProvider>
      );
      expect(screen.getByTestId("custom-color-icon")).toHaveStyle({
        backgroundColor: theme.palette.secondary.main,
        color: theme.palette.secondary.contrastText,
      });
    }
  );
  it("withholds a supplied color on a mismatched definition", () => {
    render(
      <EntityIcon
        entityType="task"
        workItemIcon={{
          typeKey: "CUSTOM",
          definition: { ...definition("other", "shield"), colorKey: "error" },
          effectiveSource: "PROJECT_CUSTOM",
        }}
        data-testid="custom-color-icon"
      />
    );
    expect(screen.getByTestId("custom-color-icon")).not.toHaveStyle({
      backgroundColor: "#d32f2f",
    });
  });
});
