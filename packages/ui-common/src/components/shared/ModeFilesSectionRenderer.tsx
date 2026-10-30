import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import React, { useContext, useMemo, useState } from "react";
import {
  MarkdownRenderer,
  type MarkdownRendererMentionConfig,
} from "./MarkdownRenderer";
import { DiffRenderer, type DiffViewMode } from "../SuggestedContent";

import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";

const MODE_FILES_SCHEMA_VERSION = "project-mode-files.v1";
const MODE_ENTRY_FILE = "MODE.md";
const MODE_FILE_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

interface ModeFilesBundle {
  files: ReadonlyMap<string, string>;
}

export type ModeFilesContentState =
  { status: "unavailable" } | { status: "valid"; bundle: ModeFilesBundle };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeRelativePath = (path: string): boolean => {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(path) || path.includes("\\")) return false;

  return path
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
};

export const readModeFilesContent = (
  content: unknown,
): ModeFilesContentState => {
  let decoded = content;
  if (typeof decoded === "string") {
    if (!decoded.trim()) return { status: "unavailable" };
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return { status: "unavailable" };
    }
  }

  if (
    !isRecord(decoded) ||
    decoded.schemaVersion !== MODE_FILES_SCHEMA_VERSION
  ) {
    return { status: "unavailable" };
  }

  const files = decoded.files;
  if (!isRecord(files)) return { status: "unavailable" };

  const entries = Object.entries(files);
  const normalizedFiles = new Map<string, string>();
  for (const [path, fileContent] of entries) {
    if (!isSafeRelativePath(path) || typeof fileContent !== "string") {
      return { status: "unavailable" };
    }
    normalizedFiles.set(path, fileContent);
  }
  if (!normalizedFiles.has(MODE_ENTRY_FILE)) {
    return { status: "unavailable" };
  }

  return {
    status: "valid",
    bundle: {
      files: normalizedFiles,
    },
  };
};

const orderFilePaths = (files: ReadonlyMap<string, string>): string[] =>
  Array.from(files.keys()).sort((left, right) => {
    if (left === MODE_ENTRY_FILE) return -1;
    if (right === MODE_ENTRY_FILE) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });

export interface ModeFilesSectionRendererProps {
  content: unknown;
  mentionConfig?: MarkdownRendererMentionConfig;
  comparison?: { currentContent: unknown; defaultViewMode: DiffViewMode };
}

/**
 * Renders the registry-owned MODE files bundle without exposing its envelope
 * as generic JSON. The component is deliberately read-only and fails closed
 * when the stored value is not the supported canonical bundle.
 */
export const ModeFilesSectionRenderer: React.FC<
  ModeFilesSectionRendererProps
> = ({ content, mentionConfig, comparison }) => {
  const inheritedMentionContext = useContext(MentionEditorContext);
  const mentionContext = mentionConfig?.navigate
    ? { ...mentionConfig, navigate: mentionConfig.navigate }
    : inheritedMentionContext;
  const normalized = useMemo(() => readModeFilesContent(content), [content]);
  const current = useMemo(
    () =>
      comparison ? readModeFilesContent(comparison.currentContent) : undefined,
    [comparison],
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  if (normalized.status === "unavailable") {
    return (
      <Alert
        severity={comparison ? "error" : "warning"}
        data-testid="mode-files-section-unavailable"
      >
        MODE files are unavailable because the stored files bundle is invalid.
      </Alert>
    );
  }

  if (current?.status === "unavailable") {
    return (
      <Alert severity="error" data-testid="mode-files-current-unavailable">
        Current MODE files could not be read. Approval is unavailable until the
        complete comparison can be shown.
      </Alert>
    );
  }
  const before = current?.bundle.files;
  const allFiles = new Map([...(before ?? []), ...normalized.bundle.files]);
  const filePaths = orderFilePaths(allFiles);
  const changeFor = (path: string) =>
    !before
      ? undefined
      : !before.has(path)
        ? "added"
        : !normalized.bundle.files.has(path)
          ? "removed"
          : before.get(path) !== normalized.bundle.files.get(path)
            ? "modified"
            : "unchanged";
  const changedPaths = filePaths.filter(
    (path) => changeFor(path) !== "unchanged",
  );
  const activePath =
    selectedPath && allFiles.has(selectedPath)
      ? selectedPath
      : (changedPaths[0] ?? MODE_ENTRY_FILE);
  const visiblePaths = before && !showUnchanged ? changedPaths : filePaths;
  const activeContent = normalized.bundle.files.get(activePath);

  return (
    <Paper
      variant="outlined"
      data-testid="mode-files-section-renderer"
      sx={{ overflow: "hidden" }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ minHeight: 260 }}>
        <Stack
          component="nav"
          aria-label="MODE files"
          data-testid="mode-files-file-list"
          spacing={0.5}
          sx={{
            width: { xs: "100%", sm: 260 },
            flexShrink: 0,
            p: 1,
            bgcolor: "action.hover",
            borderRight: { xs: 0, sm: 1 },
            borderBottom: { xs: 1, sm: 0 },
            borderColor: "divider",
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 1, pb: 0.5, fontWeight: 600 }}
          >
            Files ({filePaths.length})
          </Typography>
          {visiblePaths.map((path) => (
            <Button
              key={path}
              variant={path === activePath ? "contained" : "text"}
              color={path === activePath ? "primary" : "inherit"}
              onClick={() => setSelectedPath(path)}
              aria-pressed={path === activePath}
              data-testid="mode-files-file"
              data-file-path={path}
              data-change={changeFor(path)}
              data-file-level={path === MODE_ENTRY_FILE ? "root" : "supporting"}
              sx={{
                fontFamily: MODE_FILE_FONT_FAMILY,
                justifyContent: "flex-start",
                textAlign: "left",
                textTransform: "none",
                overflowWrap: "anywhere",
                ml: path === MODE_ENTRY_FILE ? 0 : 2,
                width: path === MODE_ENTRY_FILE ? "100%" : "calc(100% - 16px)",
              }}
            >
              {path}
              {before ? ` (${changeFor(path)})` : ""}
            </Button>
          ))}
          {before && filePaths.length > changedPaths.length ? (
            <Button
              data-testid="mode-files-toggle-unchanged"
              onClick={() => setShowUnchanged((value) => !value)}
            >
              {showUnchanged ? "Hide" : "Show"} unchanged files (
              {filePaths.length - changedPaths.length})
            </Button>
          ) : null}
        </Stack>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="mode-files-selected-path"
              sx={{ fontFamily: MODE_FILE_FONT_FAMILY }}
            >
              {activePath}
            </Typography>
          </Box>
          <Box
            data-testid="mode-files-selected-content"
            sx={{
              p: 2,
              flex: 1,
              minWidth: 0,
              overflow: "auto",
              fontFamily: MODE_FILE_FONT_FAMILY,
              "& p, & h1, & h2, & h3, & h4, & h5, & h6": {
                fontFamily: MODE_FILE_FONT_FAMILY,
              },
            }}
          >
            {before && changeFor(activePath) !== "unchanged" ? (
              <Box data-testid="mode-file-diff">
                <MentionEditorContext.Provider value={mentionContext}>
                  <DiffRenderer
                    oldContent={before.get(activePath) ?? ""}
                    newContent={activeContent ?? ""}
                    defaultViewMode={comparison?.defaultViewMode}
                    showViewModeToggle
                  />
                </MentionEditorContext.Provider>
              </Box>
            ) : (
              <MarkdownRenderer
                sx={{
                  fontFamily: MODE_FILE_FONT_FAMILY,
                  fontSize: "1rem",
                  lineHeight: 1.6,
                  "& h1, & h2, & h3, & h4, & h5, & h6": {
                    fontFamily: MODE_FILE_FONT_FAMILY,
                  },
                }}
                mentionConfig={mentionConfig}
                children={activeContent}
              />
            )}
          </Box>
        </Stack>
      </Stack>
    </Paper>
  );
};
