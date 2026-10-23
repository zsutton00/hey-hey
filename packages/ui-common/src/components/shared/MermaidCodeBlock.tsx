import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import React, { useEffect, useMemo, useRef, useState } from "react";

export interface MermaidCodeBlockProps {
  code: string;
}

type MermaidTheme = "default" | "dark";

type MermaidRenderer = typeof import("mermaid").default;

interface MermaidRenderSuccessState {
  status: "success";
  svg: string;
  errorMessage: null;
}

interface MermaidRenderLoadingState {
  status: "loading";
  svg: null;
  errorMessage: null;
}

interface MermaidRenderErrorState {
  status: "error";
  svg: null;
  errorMessage: string;
}

type MermaidRenderState =
  | MermaidRenderSuccessState
  | MermaidRenderLoadingState
  | MermaidRenderErrorState;

let configuredMermaidTheme: MermaidTheme | null = null;
let elkLayoutRegistered = false;

interface MermaidLabelDelimiter {
  close: string;
  open: string;
}

const MERMAID_LABEL_DELIMITERS: readonly MermaidLabelDelimiter[] = [
  { open: "((", close: "))" },
  { open: "[[", close: "]]" },
  { open: "|", close: "|" },
  { open: "[", close: "]" },
  { open: "(", close: ")" },
  { open: "{", close: "}" },
] as const;

const getMermaidRenderer = async (): Promise<MermaidRenderer> => {
  const mermaidModule = await import("mermaid");
  const mermaidRenderer = mermaidModule.default;

  if (!elkLayoutRegistered) {
    const elkLayoutModule = await import("@mermaid-js/layout-elk");
    mermaidRenderer.registerLayoutLoaders(elkLayoutModule.default);
    elkLayoutRegistered = true;
  }

  return mermaidRenderer;
};

const resolveMermaidTheme = (paletteMode: string): MermaidTheme =>
  paletteMode === "dark" ? "dark" : "default";

const isQuotedLabel = (value: string): boolean =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"');

const normalizeMermaidLabelText = (value: string): string => {
  if (isQuotedLabel(value)) {
    return value;
  }

  return value
    .replace(/\\n/g, " ")
    .replace(/"/g, "”")
    .replace(/'/g, "’")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）");
};

const readMermaidLabelSegment = (
  value: string,
  startIndex: number,
  delimiter: MermaidLabelDelimiter
): { nextIndex: number; normalizedSegment: string } | null => {
  const { open, close } = delimiter;
  const supportsInnerSingleCharacterPairs =
    open.length === 2 && close.length === 2;
  const singleCharacterOpen = supportsInnerSingleCharacterPairs
    ? open[0]
    : null;
  const singleCharacterClose = supportsInnerSingleCharacterPairs
    ? close[0]
    : null;
  let depth = 1;
  let index = startIndex + open.length;
  let innerSingleCharacterDepth = 0;

  while (index < value.length) {
    if (value[index] === "\n") {
      return null;
    }

    if (
      singleCharacterOpen &&
      singleCharacterClose &&
      value[index] === singleCharacterOpen &&
      !value.startsWith(open, index)
    ) {
      innerSingleCharacterDepth += 1;
      index += 1;
      continue;
    }

    if (
      singleCharacterOpen &&
      singleCharacterClose &&
      value[index] === singleCharacterClose &&
      innerSingleCharacterDepth > 0 &&
      !value.startsWith(close, index)
    ) {
      innerSingleCharacterDepth -= 1;
      index += 1;
      continue;
    }

    if (open !== close && value.startsWith(open, index)) {
      depth += 1;
      index += open.length;
      continue;
    }

    if (value.startsWith(close, index) && innerSingleCharacterDepth === 0) {
      depth -= 1;
      if (depth === 0) {
        const innerText = value.slice(startIndex + open.length, index);
        return {
          nextIndex: index + close.length,
          normalizedSegment: `${open}${normalizeMermaidLabelText(
            innerText
          )}${close}`,
        };
      }

      index += close.length;
      continue;
    }

    index += 1;
  }

  return null;
};

export const normalizeMermaidCode = (value: string): string => {
  let normalized = "";
  let index = 0;

  while (index < value.length) {
    const delimiter = MERMAID_LABEL_DELIMITERS.find(({ open }) =>
      value.startsWith(open, index)
    );

    if (!delimiter) {
      normalized += value[index];
      index += 1;
      continue;
    }

    const normalizedSegment = readMermaidLabelSegment(value, index, delimiter);
    if (!normalizedSegment) {
      normalized += value[index];
      index += 1;
      continue;
    }

    normalized += normalizedSegment.normalizedSegment;
    index = normalizedSegment.nextIndex;
  }

  return normalized;
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Mermaid diagram could not be rendered.";
};

const clearMermaidRenderHost = (renderHost: HTMLDivElement | null): void => {
  if (renderHost) {
    renderHost.innerHTML = "";
  }
};

const initializeMermaidRenderer = (
  mermaidRenderer: MermaidRenderer,
  mermaidTheme: MermaidTheme
): void => {
  if (configuredMermaidTheme === mermaidTheme) {
    return;
  }

  mermaidRenderer.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: mermaidTheme,
  });

  configuredMermaidTheme = mermaidTheme;
};

export const MermaidCodeBlock: React.FC<MermaidCodeBlockProps> = ({ code }) => {
  const theme = useTheme();
  const mermaidTheme = useMemo(
    () => resolveMermaidTheme(theme.palette.mode),
    [theme.palette.mode]
  );
  const normalizedCode = useMemo(
    () => normalizeMermaidCode(code.trim()),
    [code]
  );
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    status: "loading",
    svg: null,
    errorMessage: null,
  });
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const renderSequenceRef = useRef(0);
  const renderHostRef = useRef<HTMLDivElement | null>(null);
  const mermaidInstanceIdRef = useRef(
    `mermaid-${Math.random().toString(36).slice(2, 10)}`
  );

  useEffect(() => {
    if (normalizedCode.length === 0) {
      clearMermaidRenderHost(renderHostRef.current);
      setRenderState({
        status: "error",
        svg: null,
        errorMessage: "Mermaid diagram is empty.",
      });
      return;
    }

    let disposed = false;
    const renderSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = renderSequence;

    clearMermaidRenderHost(renderHostRef.current);
    setRenderState({
      status: "loading",
      svg: null,
      errorMessage: null,
    });

    const renderMermaid = async () => {
      try {
        const mermaidRenderer = await getMermaidRenderer();
        if (disposed || renderSequenceRef.current !== renderSequence) {
          return;
        }

        initializeMermaidRenderer(mermaidRenderer, mermaidTheme);

        const renderId = `${mermaidInstanceIdRef.current}-${renderSequence}`;
        const renderResult = await mermaidRenderer.render(
          renderId,
          normalizedCode,
          renderHostRef.current ?? undefined
        );

        if (disposed || renderSequenceRef.current !== renderSequence) {
          clearMermaidRenderHost(renderHostRef.current);
          return;
        }

        setRenderState({
          status: "success",
          svg: renderResult.svg,
          errorMessage: null,
        });
      } catch (error) {
        if (disposed || renderSequenceRef.current !== renderSequence) {
          clearMermaidRenderHost(renderHostRef.current);
          return;
        }

        clearMermaidRenderHost(renderHostRef.current);
        setRenderState({
          status: "error",
          svg: null,
          errorMessage: extractErrorMessage(error),
        });
      }
    };

    void renderMermaid();

    return () => {
      disposed = true;
      clearMermaidRenderHost(renderHostRef.current);
    };
  }, [mermaidTheme, normalizedCode]);

  return (
    <Stack spacing={1.5} data-testid="markdown-mermaid-block">
      <Box
        ref={renderHostRef}
        aria-hidden
        data-testid="markdown-mermaid-render-host"
        sx={{
          position: "absolute",
          left: "-99999px",
          top: 0,
          width: 0,
          height: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      />
      {renderState.status === "loading" && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            Rendering diagram...
          </Typography>
        </Stack>
      )}

      {renderState.status === "success" && (
        <>
          <Stack direction="row" justifyContent="flex-start">
            <Button
              size="small"
              variant="outlined"
              onClick={() => setIsViewerOpen(true)}
              data-testid="markdown-mermaid-open-viewer"
            >
              Open Viewer
            </Button>
          </Stack>
          <Box
            sx={{
              width: "min(1000px, 60vw)",
              maxWidth: "100%",
              overflowX: "auto",
              "& svg": {
                width: "100%",
                maxWidth: "100%",
                height: "auto",
                display: "block",
              },
            }}
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
          <Dialog
            open={isViewerOpen}
            onClose={() => setIsViewerOpen(false)}
            fullWidth
            maxWidth={false}
            slotProps={{
              paper: {
                sx: {
                  width: "min(1600px, 96vw)",
                  height: "92vh",
                  maxWidth: "none",
                  m: 1,
                },
              },
            }}
          >
            <DialogTitle
              sx={{
                py: 1,
                px: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="subtitle1" component="span">
                Mermaid Diagram
              </Typography>
              <IconButton
                size="small"
                onClick={() => setIsViewerOpen(false)}
                aria-label="Close Mermaid viewer"
                data-testid="markdown-mermaid-close-viewer"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent
              dividers
              sx={{
                p: 1,
                overflow: "hidden",
              }}
            >
              <Box
                data-testid="markdown-mermaid-viewer-svg"
                sx={{
                  width: "100%",
                  height: "100%",
                  overflow: "auto",
                  "& svg": {
                    maxWidth: "none",
                    minWidth: "100%",
                    width: "max-content",
                    height: "auto",
                    display: "block",
                  },
                }}
                dangerouslySetInnerHTML={{ __html: renderState.svg }}
              />
            </DialogContent>
          </Dialog>
        </>
      )}

      {renderState.status === "error" && (
        <>
          <Alert severity="warning" data-testid="markdown-mermaid-error">
            Unable to render Mermaid diagram. {renderState.errorMessage}
          </Alert>
          <Box
            component="pre"
            sx={{
              margin: 0,
              overflowX: "auto",
              p: 1.5,
              borderRadius: 1,
              backgroundColor:
                theme.palette.mode === "dark"
                  ? "rgba(255, 255, 255, 0.05)"
                  : "rgba(0, 0, 0, 0.05)",
            }}
          >
            <Box
              component="code"
              data-testid="markdown-mermaid-fallback-code"
              sx={{
                whiteSpace: "pre",
                fontFamily: "monospace",
                fontSize: "0.875rem",
              }}
            >
              {code}
            </Box>
          </Box>
        </>
      )}
    </Stack>
  );
};
