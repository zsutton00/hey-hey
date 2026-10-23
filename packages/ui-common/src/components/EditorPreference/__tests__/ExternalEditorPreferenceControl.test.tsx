import { createTheme, ThemeProvider } from "@mui/material/styles";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalEditorPreferenceControl } from "../ExternalEditorPreferenceControl";
import {
  EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
  readExternalEditorPreference,
} from "../editorPreference";

const renderControl = (onSaved = vi.fn()) => {
  render(
    <ThemeProvider theme={createTheme()}>
      <ExternalEditorPreferenceControl onSaved={onSaved} />
    </ThemeProvider>
  );
  return onSaved;
};

describe("ExternalEditorPreferenceControl", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("validates and saves a custom URL template", () => {
    const onSaved = renderControl();
    fireEvent.click(screen.getByLabelText("Custom URL template"));

    const templateInput = screen.getByTestId("external-editor-url-template");
    fireEvent.change(templateInput, { target: { value: "javascript:{path}" } });
    expect(screen.getByTestId("external-editor-save")).toBeDisabled();

    fireEvent.change(templateInput, {
      target: { value: "cursor://file/{path}:{line}:{column}" },
    });
    fireEvent.click(screen.getByTestId("external-editor-save"));

    const preference = {
      kind: "custom",
      urlTemplate: "cursor://file/{path}:{line}:{column}",
    } as const;
    expect(readExternalEditorPreference()).toEqual(preference);
    expect(onSaved).toHaveBeenCalledWith(preference);
  });

  it("resets a saved preference", () => {
    localStorage.setItem(
      EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ kind: "preset", editor: "vscode" })
    );
    renderControl();

    fireEvent.click(screen.getByTestId("external-editor-reset"));

    expect(readExternalEditorPreference()).toBeNull();
    expect(
      screen.queryByTestId("external-editor-reset")
    ).not.toBeInTheDocument();
  });
});
