import { createTheme, ThemeProvider } from "@mui/material/styles";
import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectContext, type ProjectContextValue } from "../../../contexts";
import type { LocalRepoBindingsState } from "../../../data/hooks/useLocalRepoBindings";
import { EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY } from "../../EditorPreference";
import {
  FileReferenceLink,
  type FileReferenceEditorActivation,
  type FileReferenceRenderMode,
} from "../fileReferences/FileReferenceLink";
import type { FileReferenceValueV1 } from "../fileReferences/types";

const { useLocalRepoBindingsMock, useEntityContextMock, historyPanelMock } =
  vi.hoisted(() => ({
    useLocalRepoBindingsMock: vi.fn<() => LocalRepoBindingsState>(),
    useEntityContextMock: vi.fn(),
    historyPanelMock: vi.fn(),
  }));

vi.mock("../../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: useLocalRepoBindingsMock,
}));

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: useEntityContextMock,
}));

vi.mock("../../FileTouchHistory", () => ({
  FileTouchHistoryPanel: (props: {
    open: boolean;
    organizationId: string;
    projectId: string;
    serviceId: string;
    normalizedPath: string;
  }) => {
    historyPanelMock(props);
    return props.open ? <div data-testid="file-task-history-panel" /> : null;
  },
}));

const value: FileReferenceValueV1 = {
  version: 1,
  serviceId: "service-1",
  serviceName: "UI Common",
  normalizedPath: "src/components/Editor.tsx",
};

const binding = {
  serviceId: "service-1",
  repositoryPath: "/work/ui-common",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T01:00:00.000Z",
};

const controls = {
  refetch: vi.fn(),
  markStale: vi.fn(),
};

const renderReference = (
  renderMode?: FileReferenceRenderMode,
  projectContext: ProjectContextValue | null = {
    organizationId: "org-1",
    projectId: "project-1",
    navigate: vi.fn(),
  },
  editorActivation?: FileReferenceEditorActivation
) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <ProjectContext.Provider value={projectContext}>
        <FileReferenceLink
          value={value}
          renderMode={renderMode}
          editorActivation={editorActivation}
        />
      </ProjectContext.Provider>
    </ThemeProvider>
  );

describe("FileReferenceLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useLocalRepoBindingsMock.mockReturnValue({
      status: "ready",
      bindings: [binding],
      bindingsByServiceId: { "service-1": binding },
      ...controls,
    });
  });

  it.each(["mapped", "unmapped"] as const)(
    "opens task history with the complete portable identity when %s",
    (mapping) => {
      if (mapping === "unmapped") {
        useLocalRepoBindingsMock.mockReturnValue({
          status: "empty",
          bindings: [],
          bindingsByServiceId: {},
          ...controls,
        });
      }

      renderReference();
      expect(
        screen.queryByRole("button", { name: "Show Tasks" })
      ).not.toBeInTheDocument();
      fireEvent.contextMenu(screen.getByTestId("file-reference"), {
        clientX: 40,
        clientY: 60,
      });
      expect(
        screen.queryByTestId("file-reference-menu-go-to-file")
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("file-reference-menu-show-tasks"));

      expect(screen.getByTestId("file-task-history-panel")).toBeInTheDocument();
      expect(historyPanelMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true,
          organizationId: "org-1",
          projectId: "project-1",
          serviceId: "service-1",
          normalizedPath: "src/components/Editor.tsx",
        })
      );
      expect(useEntityContextMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
    }
  );

  it("omits file actions without project context", () => {
    renderReference(undefined, null);
    fireEvent.contextMenu(screen.getByTestId("file-reference"));

    expect(
      screen.queryByTestId("file-reference-context-menu")
    ).not.toBeInTheDocument();
    expect(useEntityContextMock).not.toHaveBeenCalled();
  });

  it.each<LocalRepoBindingsState>([
    { status: "loading", bindings: [], bindingsByServiceId: {}, ...controls },
    { status: "empty", bindings: [], bindingsByServiceId: {}, ...controls },
    {
      status: "error",
      bindings: [],
      bindingsByServiceId: {},
      error: new Error("Unavailable"),
      ...controls,
    },
    {
      status: "ready",
      bindings: [binding],
      bindingsByServiceId: {},
      ...controls,
    },
  ])(
    "keeps a readable portable label non-interactive in $status state",
    (state) => {
      useLocalRepoBindingsMock.mockReturnValue(state);
      renderReference();

      expect(
        screen.getByText("UI Common/src/components/Editor.tsx")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("file-reference-link")
      ).not.toBeInTheDocument();
    }
  );

  it("keeps an invalid mapped path visible and non-interactive", () => {
    useLocalRepoBindingsMock.mockReturnValue({
      status: "ready",
      bindings: [binding],
      bindingsByServiceId: { "service-1": binding },
      ...controls,
    });
    render(
      <ThemeProvider theme={createTheme()}>
        <FileReferenceLink
          value={{ ...value, normalizedPath: "../outside.ts" }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("UI Common/../outside.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it.each(["ready", "fetching"] as const)(
    "keeps a portable reference non-interactive while %s",
    (status) => {
      useLocalRepoBindingsMock.mockReturnValue({
        status,
        bindings: [binding],
        bindingsByServiceId: { "service-1": binding },
        ...controls,
      });
      renderReference();

      expect(screen.getByTestId("file-reference")).toHaveTextContent(
        "UI Common/src/components/Editor.tsx"
      );
      expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
    }
  );

  it.each<{
    renderMode: FileReferenceRenderMode | undefined;
    expectedLabel: string;
  }>([
    {
      renderMode: undefined,
      expectedLabel: "UI Common/src/components/Editor.tsx",
    },
    { renderMode: "path", expectedLabel: "src/components/Editor.tsx" },
    { renderMode: "file-name", expectedLabel: "Editor.tsx" },
  ])(
    "renders $expectedLabel in $renderMode mode",
    ({ renderMode, expectedLabel }) => {
      renderReference(renderMode);

      expect(screen.getByTestId("file-reference")).toHaveTextContent(
        expectedLabel
      );
    }
  );

  it("keeps an unmapped path-only reference readable and non-interactive", () => {
    useLocalRepoBindingsMock.mockReturnValue({
      status: "empty",
      bindings: [],
      bindingsByServiceId: {},
      ...controls,
    });
    renderReference("path");

    expect(screen.getByText("src/components/Editor.tsx")).toBeInTheDocument();
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("does not navigate a portable reference even when an editor is configured", () => {
    localStorage.setItem(
      EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        kind: "custom",
        urlTemplate: "cursor://file/{path}:{line}:{column}",
      })
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderReference();

    fireEvent.click(screen.getByTestId("file-reference"));

    expect(open).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("external-editor-setup-dialog")
    ).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not expose editor activation in the file menu", () => {
    localStorage.setItem(
      EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        kind: "custom",
        urlTemplate: "cursor://file/{path}:{line}:{column}",
      })
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderReference(undefined, undefined, "context-menu");

    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("file-reference-actions"), {
      key: "Enter",
    });

    expect(screen.queryByTestId("file-reference-menu-go-to-file")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps Show Tasks available without offering Go to file when unmapped", () => {
    useLocalRepoBindingsMock.mockReturnValue({
      status: "empty",
      bindings: [],
      bindingsByServiceId: {},
      ...controls,
    });
    renderReference(undefined, undefined, "context-menu");

    fireEvent.contextMenu(screen.getByTestId("file-reference"));

    expect(
      screen.queryByTestId("file-reference-menu-go-to-file")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("file-reference-menu-show-tasks")
    ).toBeInTheDocument();
  });

  it("does not open editor setup for a portable reference", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderReference();

    fireEvent.click(screen.getByTestId("file-reference"));

    expect(screen.queryByTestId("external-editor-setup-dialog")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not show editor setup when a portable reference is clicked", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderReference();

    fireEvent.click(screen.getByTestId("file-reference"));

    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByTestId("external-editor-setup-dialog")).not.toBeInTheDocument();
  });
});
