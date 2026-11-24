import { render, screen } from "@testing-library/react";
import { TextField } from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  createHeyTheme,
  getInputBorderColors,
  getInputBorderSx,
} from "../ThemeContext";
import { SmarterTextAreaCard } from "../../components/SmarterTextAreaCard/SmarterTextAreaCard";
import { ResolutionTextEditor } from "../../components/ProposalReconciliation/ResolutionTextEditor";
import { EntityPromptTemplateEditor } from "../../components/EntityPromptTemplateEditor/EntityPromptTemplateEditor";
import { SelectableEntityList } from "../../components/SelectableEntityList";

vi.mock("../../hooks/useEditorContext", () => ({
  useProjectIds: () => null,
}));

describe("input border contrast tokens and surfaces", () => {
  it("exposes high-contrast light-mode and preserved dark-mode inputBorder tokens", () => {
    const lightTheme = createHeyTheme("light");
    const darkTheme = createHeyTheme("dark");

    expect(lightTheme.palette.inputBorder).toEqual({
      default: "rgba(0, 0, 0, 0.45)",
      hover: "rgba(0, 0, 0, 0.72)",
    });
    expect(darkTheme.palette.inputBorder).toEqual({
      default: "#666",
      hover: "rgba(255, 255, 255, 0.56)",
    });
  });

  it("falls back safely under bare MUI themes", () => {
    const bareLight = createTheme({ palette: { mode: "light" } });
    const bareDark = createTheme({ palette: { mode: "dark" } });

    expect(getInputBorderColors(bareLight).default).toBe("rgba(0, 0, 0, 0.45)");
    expect(getInputBorderColors(bareDark).default).toBe("#666");
  });

  it("builds consistent light-mode border rules and leaves dark mode unchanged", () => {
    const lightTheme = createHeyTheme("light");
    const darkTheme = createHeyTheme("dark");

    const resting = getInputBorderSx(lightTheme);
    expect(resting.border).toBe("1px solid rgba(0, 0, 0, 0.45)");
    expect(resting["&:hover"]).toEqual({
      borderColor: "rgba(0, 0, 0, 0.72)",
    });
    expect(resting["&:focus-within"]).toEqual({
      borderColor: lightTheme.palette.primary.main,
      boxShadow: `inset 0 0 0 1px ${lightTheme.palette.primary.main}`,
    });

    const errored = getInputBorderSx(lightTheme, { error: true });
    expect(errored.border).toBe(`1px solid ${lightTheme.palette.error.main}`);
    expect(errored["&:hover"]).toEqual({});
    expect(errored["&:focus-within"]).toEqual({
      borderColor: lightTheme.palette.error.main,
      boxShadow: `inset 0 0 0 1px ${lightTheme.palette.error.main}`,
    });

    const disabled = getInputBorderSx(lightTheme, { disabled: true });
    expect(disabled.border).toBe(
      `1px solid ${lightTheme.palette.action.disabled}`,
    );
    expect(disabled["&:hover"]).toEqual({});
    expect(disabled["&:focus-within"]).toEqual({});

    expect(getInputBorderSx(darkTheme)).toEqual({});
    expect(
      getInputBorderSx(darkTheme, { disabled: true, error: true }),
    ).toEqual({});
  });

  it("applies the shared light-mode border to MUI OutlinedInput without overriding dark mode", () => {
    const lightTheme = createHeyTheme("light");
    const darkTheme = createHeyTheme("dark");

    expect(lightTheme.components?.MuiOutlinedInput).toBeDefined();
    expect(darkTheme.components?.MuiOutlinedInput).toBeUndefined();

    const { container, unmount } = render(
      <ThemeProvider theme={lightTheme}>
        <TextField label="Notes" multiline minRows={3} />
      </ThemeProvider>,
    );

    const lightOutline = container.querySelector(
      ".MuiOutlinedInput-notchedOutline",
    ) as HTMLElement | null;
    expect(lightOutline).not.toBeNull();
    expect(getComputedStyle(lightOutline!).borderColor).toBe(
      "rgba(0, 0, 0, 0.45)",
    );

    unmount();

    const { container: darkContainer } = render(
      <ThemeProvider theme={darkTheme}>
        <TextField label="Notes" multiline minRows={3} />
      </ThemeProvider>,
    );

    const darkOutline = darkContainer.querySelector(
      ".MuiOutlinedInput-notchedOutline",
    ) as HTMLElement | null;
    expect(darkOutline).not.toBeNull();
    expect(getComputedStyle(darkOutline!).borderColor).not.toBe(
      "rgb(102, 102, 102)",
    );
  });

  it("applies the shared light-mode and dark-mode borders to SmarterTextAreaCard", () => {
    const lightTheme = createHeyTheme("light");
    const { unmount } = render(
      <MemoryRouter>
        <ThemeProvider theme={lightTheme}>
          <SmarterTextAreaCard
            value=""
            onChange={vi.fn()}
            saveStatus="draft"
            saveMode={null}
            hasUnsavedChanges={false}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const lightInput = screen.getByTestId("smarter-textarea-input");
    const lightContainer = lightInput.parentElement!;
    expect(getComputedStyle(lightContainer).borderColor).toBe(
      "rgba(0, 0, 0, 0.45)",
    );

    unmount();

    const darkTheme = createHeyTheme("dark");
    render(
      <MemoryRouter>
        <ThemeProvider theme={darkTheme}>
          <SmarterTextAreaCard
            value=""
            onChange={vi.fn()}
            saveStatus="draft"
            saveMode={null}
            hasUnsavedChanges={false}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const darkInput = screen.getByTestId("smarter-textarea-input");
    const darkContainer = darkInput.parentElement!;
    expect(getComputedStyle(darkContainer).borderColor).toBe(
      "rgb(102, 102, 102)",
    );
  });

  it("applies the shared light-mode border to ResolutionTextEditor and EntityPromptTemplateEditor", () => {
    const lightTheme = createHeyTheme("light");
    render(
      <MemoryRouter>
        <ThemeProvider theme={lightTheme}>
          <ResolutionTextEditor
            value=""
            onChange={vi.fn()}
            disabled={false}
            label="Resolution"
            organizationId="org-1"
            projectId="proj-1"
          />
          <EntityPromptTemplateEditor
            source={{ content: "", syntaxVersion: "V1" }}
            readOnly={false}
            validation={{ status: "idle" }}
            onChange={vi.fn()}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const resolutionContainer = screen.getByTestId(
      "resolution-text-editor",
    ).parentElement!;
    expect(getComputedStyle(resolutionContainer).borderColor).toBe(
      "rgba(0, 0, 0, 0.45)",
    );

    const templateContainer = screen.getByTestId(
      "entity-prompt-template-editor-input",
    ).parentElement!;
    expect(getComputedStyle(templateContainer).borderColor).toBe(
      "rgba(0, 0, 0, 0.45)",
    );
  });

  it("applies the shared light-mode border to editable multiline fields in SelectableEntityList only in light mode", () => {
    const lightTheme = createHeyTheme("light");
    const darkTheme = createHeyTheme("dark");
    const items = [
      {
        id: "item-1",
        title: "Task one",
        description: "Initial description",
        comment: "Initial feedback",
      },
    ];

    const { unmount } = render(
      <ThemeProvider theme={lightTheme}>
        <SelectableEntityList
          items={items}
          editable
          onDescriptionChange={vi.fn()}
          onCommentChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    const lightDescriptionRoot = screen
      .getByLabelText("Description")
      .closest(".MuiInputBase-root") as HTMLElement;
    const lightCommentRoot = screen
      .getByLabelText("Comment")
      .closest(".MuiInputBase-root") as HTMLElement;
    expect(getComputedStyle(lightDescriptionRoot).borderColor).toBe(
      "rgba(0, 0, 0, 0.45)",
    );
    expect(getComputedStyle(lightCommentRoot).borderColor).toBe(
      "rgba(0, 0, 0, 0.45)",
    );

    unmount();

    render(
      <ThemeProvider theme={darkTheme}>
        <SelectableEntityList
          items={items}
          editable
          onDescriptionChange={vi.fn()}
          onCommentChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    const darkDescriptionRoot = screen
      .getByLabelText("Description")
      .closest(".MuiInputBase-root") as HTMLElement;
    const darkCommentRoot = screen
      .getByLabelText("Comment")
      .closest(".MuiInputBase-root") as HTMLElement;
    expect(getComputedStyle(darkDescriptionRoot).borderTopStyle).not.toBe(
      "solid",
    );
    expect(getComputedStyle(darkCommentRoot).borderTopStyle).not.toBe("solid");
  });
});
