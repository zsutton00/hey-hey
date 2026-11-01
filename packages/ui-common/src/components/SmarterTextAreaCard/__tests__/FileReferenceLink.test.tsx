import { createTheme, ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectContext, type ProjectContextValue } from "../../../contexts";
import { EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY } from "../../EditorPreference";
import {
  FileReferenceLink,
  type FileReferenceEditorActivation,
  type FileReferenceRenderMode,
} from "../fileReferences/FileReferenceLink";
import type { FileReferenceValueV1 } from "../fileReferences/types";

const { useEntityContextMock, historyPanelMock } = vi.hoisted(() => ({
  useEntityContextMock: vi.fn(),
  historyPanelMock: vi.fn(),
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

const renderReference = (
  renderMode?: FileReferenceRenderMode,
  projectContext: ProjectContextValue | null = {
    organizationId: "org-1",
    projectId: "project-1",
    navigate: vi.fn(),
  },
  editorActivation?: FileReferenceEditorActivation,
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
    </ThemeProvider>,
  );

const repoResponse = (mapped: boolean) =>
  new Response(
    JSON.stringify({
      machineId: "machine-1",
      bindings: mapped ? [binding] : [],
    }),
    { headers: { "content-type": "application/json" } },
  );

// Resolve requests inside act so each test observes the completed lookup.
const renderResolvedReference = async (
  mapped = false,
  renderMode?: FileReferenceRenderMode,
  projectContext?: ProjectContextValue | null,
  editorActivation?: FileReferenceEditorActivation,
) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(repoResponse(mapped));
  await act(async () => {
    renderReference(renderMode, projectContext, editorActivation);
  });
};

describe("FileReferenceLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it.each([true, false])(
    "opens task history with the complete portable identity (mapped: %s)",
    async (mapped) => {
      await renderResolvedReference(mapped);
      fireEvent.contextMenu(screen.getByTestId("file-reference"));
      fireEvent.click(screen.getByTestId("file-reference-menu-show-tasks"));
      expect(screen.getByTestId("file-task-history-panel")).toBeInTheDocument();
      expect(historyPanelMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true,
          organizationId: "org-1",
          projectId: "project-1",
          serviceId: value.serviceId,
          normalizedPath: value.normalizedPath,
        }),
      );
      expect(useEntityContextMock).not.toHaveBeenCalled();
    },
  );

  it("omits file actions without project context", async () => {
    await renderResolvedReference(false, undefined, null);
    fireEvent.contextMenu(screen.getByTestId("file-reference"));
    expect(
      screen.queryByTestId("file-reference-context-menu"),
    ).not.toBeInTheDocument();
  });

  it.each([
    [undefined, "UI Common/src/components/Editor.tsx"],
    ["path", "src/components/Editor.tsx"],
    ["file-name", "Editor.tsx"],
  ] satisfies [FileReferenceRenderMode | undefined, string][])(
    "keeps an unmapped reference readable in %s mode",
    async (mode, label) => {
      await renderResolvedReference(false, mode);
      expect(screen.getByTestId("file-reference")).toHaveTextContent(label);
      expect(
        screen.queryByTestId("file-reference-link"),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps a reference non-interactive until its local mapping resolves", async () => {
    let resolveRequest!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderReference();
    expect(screen.getByTestId("file-reference")).toHaveTextContent(
      "UI Common/src/components/Editor.tsx",
    );
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
    await act(async () => {
      resolveRequest(repoResponse(true));
    });
    expect(screen.getByTestId("file-reference-link")).toHaveAttribute(
      "data-source-path",
      "/work/ui-common/src/components/Editor.tsx",
    );
  });

  it("keeps a readable reference non-interactive when the local CLI is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unavailable"));
    await act(async () => {
      renderReference();
    });
    expect(screen.getByTestId("file-reference")).toHaveTextContent(
      "UI Common/src/components/Editor.tsx",
    );
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("keeps an invalid mapped path visible and non-interactive", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(repoResponse(true));
    await act(async () => {
      render(
        <ThemeProvider theme={createTheme()}>
          <FileReferenceLink
            value={{ ...value, normalizedPath: "../outside.ts" }}
          />
        </ThemeProvider>,
      );
    });
    expect(screen.getByText("UI Common/../outside.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("keeps Show Tasks available without Go to file or editor setup when unmapped", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await renderResolvedReference();
    fireEvent.click(screen.getByTestId("file-reference"));
    fireEvent.contextMenu(screen.getByTestId("file-reference"));
    expect(
      screen.getByTestId("file-reference-menu-show-tasks"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("file-reference-menu-go-to-file"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("external-editor-setup-dialog"),
    ).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a mapped file in the configured editor", async () => {
    localStorage.setItem(
      EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        kind: "custom",
        urlTemplate: "cursor://file/{path}:{line}:{column}",
      }),
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await renderResolvedReference(true);
    fireEvent.click(screen.getByTestId("file-reference-link"));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("cursor://file/"),
      "_self",
      "noopener,noreferrer",
    );
  });

  it("offers mapped file activation through the context menu", async () => {
    await renderResolvedReference(true, undefined, undefined, "context-menu");
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("file-reference-actions"), {
      key: "Enter",
    });
    fireEvent.click(screen.getByTestId("file-reference-menu-go-to-file"));
    expect(
      screen.getByTestId("external-editor-setup-dialog"),
    ).toBeInTheDocument();
  });
});
