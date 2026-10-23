import { Box, Typography, useTheme } from "@mui/material";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildFullFileSplit,
  type FullFileSplitRow,
} from "../../../utils/buildFullFileSplit";
import { filterCommentRows } from "../../../utils/filterCommentRows";
import { resolvePrismLanguage } from "../../../utils/prismLanguage";
import { tokenizeLine } from "../../../utils/highlightLine";
import { DiffDecisionAnnotation } from "./DiffDecisionAnnotation";
import { HighlightedTokens } from "./HighlightedTokens";
import { getDiffTokenColors, type DiffTokenColorMap } from "./diffTokenColors";
import type { LocatedDecision } from "./locatedDecisions";

export interface FullFileSplitViewProps {
  /** File contents before the change. Null for added files. */
  preContent: string | null;
  /** File contents after the change. Null for deleted files. */
  postContent: string | null;
  /** Path of the file being diffed, used to resolve its comment syntax. */
  filePath: string;
  /** The visual arrangement used to emit each normalized paired row. */
  presentationMode: DiffPresentationMode;
  /**
   * When true, rows whose visible side(s) are wholly comments are hidden.
   * Defaults to false, in which case the diff renders every row.
   */
  hideComments?: boolean;
  /**
   * Located IMPLEMENT-report decisions scoped to this file. Each is anchored
   * inline on the After (post-edit) side. Defaults to no annotations, in which
   * case the diff renders exactly as it would without this prop.
   */
  annotations?: LocatedDecision[];
}

export const DIFF_PRESENTATION_MODES = {
  sideBySide: "side-by-side",
  vertical: "vertical",
} as const;

export type DiffPresentationMode =
  (typeof DIFF_PRESENTATION_MODES)[keyof typeof DIFF_PRESENTATION_MODES];

type DiffPane = "old" | "new";
type MeasuredPresentationPane = DiffPane | "vertical";

const CODE_FONT_FAMILY =
  '"Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const ROW_MIN_HEIGHT = "1.6em";

/**
 * Per-row size of a single unwrapped code line at the pane's 0.75rem font
 * size and 1.6 line-height (12px × 1.6). Used as the per-wrap unit when
 * estimating an unmeasured row's height.
 */
const SINGLE_LINE_HEIGHT_PX = 19.2;

/**
 * `maxWidth: "100ch"` on the code cell caps wrap width at ~100 monospace
 * characters in the common viewport. Estimating wrap count from line length
 * against this constant keeps unmeasured rows close enough to truth that
 * the scrollbar barely shifts as rows below the viewport mount and measure.
 */
const ESTIMATED_CHARS_PER_LINE = 100;

/**
 * Rough rendered height of one collapsed DiffDecisionAnnotation card plus
 * its inter-card gap. Used only to seed the estimate; ResizeObserver-driven
 * measurement replaces it once the row mounts.
 */
const ANNOTATION_ESTIMATE_PX = 36;

const OVERVIEW_RULER_WIDTH_PX = 12;
const OVERVIEW_RULER_MIN_MARK_PX = 3;

const SPLIT_RATIO_STORAGE_KEY = "diffViewer.splitRatio";
const SPLIT_RATIO_DEFAULT = 0.5;
const MIN_PANE_WIDTH_PX = 120;

const clampSplitRatio = (ratio: number, containerWidth: number): number => {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  if (containerWidth <= 0) return SPLIT_RATIO_DEFAULT;
  const minRatio = MIN_PANE_WIDTH_PX / containerWidth;
  const maxRatio = 1 - minRatio;
  return Math.min(maxRatio, Math.max(minRatio, ratio));
};

const readStoredSplitRatio = (): number => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return SPLIT_RATIO_DEFAULT;
    }
    const raw = window.localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
    if (raw === null) return SPLIT_RATIO_DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return SPLIT_RATIO_DEFAULT;
    return Math.min(1, Math.max(0, parsed));
  } catch {
    return SPLIT_RATIO_DEFAULT;
  }
};

const writeStoredSplitRatio = (value: number): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(value));
  } catch {
    // localStorage unavailable
  }
};

const isChangeRow = (row: FullFileSplitRow): boolean =>
  row.type === "insert" || row.type === "delete" || row.type === "replace";

interface ChangeSegment {
  startIndex: number;
  endIndex: number;
  hasInsert: boolean;
  hasDelete: boolean;
}

const buildChangeSegments = (rows: FullFileSplitRow[]): ChangeSegment[] => {
  const segments: ChangeSegment[] = [];
  let current: ChangeSegment | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!isChangeRow(row)) {
      current = null;
      continue;
    }
    const hasInsert = row.type === "insert" || row.type === "replace";
    const hasDelete = row.type === "delete" || row.type === "replace";
    if (current === null) {
      current = {
        startIndex: i,
        endIndex: i,
        hasInsert,
        hasDelete,
      };
      segments.push(current);
    } else {
      current.endIndex = i;
      current.hasInsert = current.hasInsert || hasInsert;
      current.hasDelete = current.hasDelete || hasDelete;
    }
  }

  return segments;
};

/**
 * Map each annotation to the new-pane row index it anchors to. An annotation
 * whose `location.startLine` matches a row's `newLineNumber` anchors there;
 * one with no `startLine` (or no matching row) anchors at the file's first
 * changed row. Multiple annotations sharing a row are collected together so
 * they can be stacked without collision.
 */
const buildAnnotationsByRowIndex = (
  rows: FullFileSplitRow[],
  annotations: LocatedDecision[],
  firstChangeIndex: number,
): Map<number, LocatedDecision[]> => {
  const map = new Map<number, LocatedDecision[]>();
  if (annotations.length === 0 || rows.length === 0) return map;

  const fallbackIndex = firstChangeIndex >= 0 ? firstChangeIndex : 0;

  for (const annotation of annotations) {
    const startLine = annotation.location.startLine;
    let rowIndex = -1;
    if (typeof startLine === "number") {
      rowIndex = rows.findIndex((row) => row.newLineNumber === startLine);
    }
    if (rowIndex === -1) {
      rowIndex = fallbackIndex;
    }
    const bucket = map.get(rowIndex);
    if (bucket) {
      bucket.push(annotation);
    } else {
      map.set(rowIndex, [annotation]);
    }
  }

  return map;
};

const resolveLineColors = (
  pane: DiffPane,
  rowType: FullFileSplitRow["type"],
  paletteMode: "light" | "dark",
): { backgroundColor: string } => {
  if (pane === "old" && (rowType === "delete" || rowType === "replace")) {
    return {
      backgroundColor:
        paletteMode === "dark"
          ? "rgba(248, 81, 73, 0.15)"
          : "rgba(198, 40, 40, 0.12)",
    };
  }

  if (pane === "new" && (rowType === "insert" || rowType === "replace")) {
    return {
      backgroundColor:
        paletteMode === "dark"
          ? "rgba(46, 160, 67, 0.15)"
          : "rgba(46, 125, 50, 0.12)",
    };
  }

  return { backgroundColor: "transparent" };
};

const resolveGutterPrefix = (
  pane: DiffPane,
  rowType: FullFileSplitRow["type"],
): string => {
  if (pane === "old" && (rowType === "delete" || rowType === "replace")) {
    return "-";
  }
  if (pane === "new" && (rowType === "insert" || rowType === "replace")) {
    return "+";
  }
  return " ";
};

interface DiffLineProps {
  pane: DiffPane;
  row: FullFileSplitRow;
  languageId: string | null;
  tokenColors: DiffTokenColorMap;
  renderAbsentLine?: boolean;
}

const DiffLine: React.FC<DiffLineProps> = ({
  pane,
  row,
  languageId,
  tokenColors,
  renderAbsentLine = true,
}) => {
  const theme = useTheme();
  const line = pane === "old" ? row.oldLine : row.newLine;
  if (line === null && !renderAbsentLine) return null;

  const lineNumber = pane === "old" ? row.oldLineNumber : row.newLineNumber;
  const colors = resolveLineColors(pane, row.type, theme.palette.mode);
  const prefix = resolveGutterPrefix(pane, row.type);
  const isAbsent = line === null;

  return (
    <Box
      component="code"
      data-diff-side={pane}
      sx={{
        display: "grid",
        gridTemplateColumns: "3rem 1.5rem 1fr",
        alignItems: "stretch",
        minHeight: ROW_MIN_HEIGHT,
        backgroundColor: isAbsent
          ? theme.palette.mode === "dark"
            ? "rgba(255, 255, 255, 0.03)"
            : "rgba(0, 0, 0, 0.03)"
          : colors.backgroundColor,
      }}
    >
      <Box
        component="span"
        sx={{
          userSelect: "none",
          textAlign: "right",
          pr: 0.5,
          borderRight: "1px solid",
          borderColor: "divider",
          color: "text.secondary",
          backgroundColor: "action.hover",
        }}
      >
        {lineNumber ?? ""}
      </Box>
      <Box
        component="span"
        sx={{
          textAlign: "center",
          userSelect: "none",
          color: "text.secondary",
          fontWeight: 600,
        }}
      >
        {isAbsent ? "" : prefix}
      </Box>
      <Box
        component="span"
        sx={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxWidth: "100ch",
          px: 1.25,
        }}
      >
        {isAbsent ? (
          " "
        ) : (
          <HighlightedTokens
            tokens={tokenizeLine(line, languageId)}
            colors={tokenColors}
          />
        )}
      </Box>
    </Box>
  );
};

interface AnnotationSlotProps {
  annotations: LocatedDecision[] | undefined;
  rowIndex: number;
  visible: boolean;
}

const AnnotationSlot: React.FC<AnnotationSlotProps> = ({
  annotations,
  rowIndex,
  visible,
}) => {
  if (!annotations || annotations.length === 0) return null;
  return (
    <Box
      {...(visible
        ? {
            "data-testid": `full-file-split-annotations-row-${String(
              rowIndex,
            )}`,
          }
        : { "aria-hidden": true })}
      sx={{ px: 1.25, ...(visible ? null : { visibility: "hidden" }) }}
    >
      {annotations.map((decision, index) => (
        <DiffDecisionAnnotation
          decision={decision}
          key={index}
          {...(visible
            ? {
                testId: `diff-decision-annotation-${String(
                  rowIndex,
                )}-${String(index)}`,
              }
            : {})}
        />
      ))}
    </Box>
  );
};

interface PaneProps {
  pane: DiffPane;
  rows: FullFileSplitRow[];
  /** Windowed rows produced by the shared virtualizer. */
  virtualItems: VirtualItem[];
  /** Total scrollable height of the row list, from the shared virtualizer. */
  totalSize: number;
  /**
   * Offset of the panes below the Before/After captions inside the shared
   * scroll container. Subtracted from each virtual item's start so rows sit at
   * the right place within the pane.
   */
  scrollMargin: number;
  annotationsByRowIndex: Map<number, LocatedDecision[]>;
  /**
   * Prism language id for the file, or `null` when the extension is unknown.
   * Threaded down so each row can tokenize its own visible side without the
   * pane re-resolving the language per row.
   */
  languageId: string | null;
  /** Theme-aware token color palette used by {@link HighlightedTokens}. */
  tokenColors: DiffTokenColorMap;
  /** Attached to the pane root so its offset within the scroll container can be measured. */
  rootRef?: React.Ref<HTMLPreElement>;
  /**
   * Ref callback from the shared virtualizer. Attached to each row wrapper so
   * the virtualizer's ResizeObserver tracks the wrapper's rendered height
   * (row content plus annotation slot). Both panes attach the same callback
   * with their own `data-pane`, and the virtualizer's `measureElement`
   * override unions the two per row index.
   */
  measureRow: (node: HTMLElement | null) => void;
}

const DiffPane: React.FC<PaneProps> = ({
  pane,
  rows,
  virtualItems,
  totalSize,
  scrollMargin,
  annotationsByRowIndex,
  languageId,
  tokenColors,
  rootRef,
  measureRow,
}) => {
  const theme = useTheme();

  return (
    <Box
      component="pre"
      ref={rootRef}
      data-testid={`full-file-split-pane-${pane}`}
      sx={{
        m: 0,
        p: 0,
        borderRadius: 1,
        position: "relative",
        height: `${String(totalSize)}px`,
        overflowX: "auto",
        fontFamily: CODE_FONT_FAMILY,
        fontSize: "0.75rem",
        lineHeight: 1.6,
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(255, 255, 255, 0.02)"
            : "rgba(0, 0, 0, 0.02)",
      }}
    >
      {virtualItems.map((virtualItem) => {
        const rowIndex = virtualItem.index;
        const row = rows[rowIndex];

        // Each windowed row is absolutely positioned at its virtual offset
        // inside the spacer-sized pane, so only viewport-adjacent indices
        // mount. Both panes consume the same windowed slice, so the Before and
        // After sides stay row-aligned. The annotation slot rides along inside
        // the same item.
        return (
          <Box
            key={virtualItem.key}
            ref={measureRow}
            data-index={rowIndex}
            data-pane={pane}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${String(
                virtualItem.start - scrollMargin,
              )}px)`,
            }}
          >
            <DiffLine
              pane={pane}
              row={row}
              languageId={languageId}
              tokenColors={tokenColors}
            />
            <AnnotationSlot
              annotations={annotationsByRowIndex.get(rowIndex)}
              rowIndex={rowIndex}
              visible={pane === "new"}
            />
          </Box>
        );
      })}
    </Box>
  );
};

interface SideBySideDiffPresentationProps {
  rows: FullFileSplitRow[];
  virtualItems: VirtualItem[];
  totalSize: number;
  scrollMargin: number;
  annotationsByRowIndex: Map<number, LocatedDecision[]>;
  languageId: string | null;
  tokenColors: DiffTokenColorMap;
  oldPaneRef: React.Ref<HTMLPreElement>;
  newPaneRef: React.Ref<HTMLPreElement>;
  measureRow: (node: HTMLElement | null) => void;
  onDividerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDividerPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDividerPointerUp: () => void;
}

const presentationCaptionSx = {
  display: "block",
  mb: 0.5,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  color: "text.secondary",
  fontWeight: 600,
} as const;

const SideBySideDiffPresentation: React.FC<SideBySideDiffPresentationProps> = ({
  rows,
  virtualItems,
  totalSize,
  scrollMargin,
  annotationsByRowIndex,
  languageId,
  tokenColors,
  oldPaneRef,
  newPaneRef,
  measureRow,
  onDividerPointerDown,
  onDividerPointerMove,
  onDividerPointerUp,
}) => (
  <>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={presentationCaptionSx}>
        Before
      </Typography>
      <DiffPane
        pane="old"
        rows={rows}
        virtualItems={virtualItems}
        totalSize={totalSize}
        scrollMargin={scrollMargin}
        annotationsByRowIndex={annotationsByRowIndex}
        languageId={languageId}
        tokenColors={tokenColors}
        rootRef={oldPaneRef}
        measureRow={measureRow}
      />
    </Box>
    <Box
      data-testid="full-file-split-divider"
      onPointerDown={onDividerPointerDown}
      onPointerMove={onDividerPointerMove}
      onPointerUp={onDividerPointerUp}
      onPointerCancel={onDividerPointerUp}
      sx={{
        cursor: "col-resize",
        display: "flex",
        alignItems: "stretch",
        userSelect: "none",
        touchAction: "none",
        width: 4,
        "&::before": {
          content: '""',
          width: "1px",
          mx: "auto",
          backgroundColor: "divider",
        },
        "&:hover::before, &:active::before": {
          backgroundColor: "action.active",
          width: "2px",
        },
      }}
    />
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={presentationCaptionSx}>
        After
      </Typography>
      <DiffPane
        pane="new"
        rows={rows}
        virtualItems={virtualItems}
        totalSize={totalSize}
        scrollMargin={scrollMargin}
        annotationsByRowIndex={annotationsByRowIndex}
        languageId={languageId}
        tokenColors={tokenColors}
        rootRef={newPaneRef}
        measureRow={measureRow}
      />
    </Box>
  </>
);

interface VerticalDiffPresentationProps {
  rows: FullFileSplitRow[];
  virtualItems: VirtualItem[];
  totalSize: number;
  scrollMargin: number;
  annotationsByRowIndex: Map<number, LocatedDecision[]>;
  languageId: string | null;
  tokenColors: DiffTokenColorMap;
  rootRef: React.Ref<HTMLPreElement>;
  measureRow: (node: HTMLElement | null) => void;
}

const VerticalDiffPresentation: React.FC<VerticalDiffPresentationProps> = ({
  rows,
  virtualItems,
  totalSize,
  scrollMargin,
  annotationsByRowIndex,
  languageId,
  tokenColors,
  rootRef,
  measureRow,
}) => {
  const theme = useTheme();
  return (
    <Box
      component="pre"
      ref={rootRef}
      data-testid="full-file-split-pane-vertical"
      sx={{
        m: 0,
        p: 0,
        borderRadius: 1,
        position: "relative",
        height: `${String(totalSize)}px`,
        overflowX: "auto",
        fontFamily: CODE_FONT_FAMILY,
        fontSize: "0.75rem",
        lineHeight: 1.6,
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(255, 255, 255, 0.02)"
            : "rgba(0, 0, 0, 0.02)",
      }}
    >
      {virtualItems.map((virtualItem) => {
        const rowIndex = virtualItem.index;
        const row = rows[rowIndex];
        return (
          <Box
            key={virtualItem.key}
            ref={measureRow}
            data-index={rowIndex}
            data-pane="vertical"
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${String(
                virtualItem.start - scrollMargin,
              )}px)`,
            }}
          >
            <DiffLine
              pane="old"
              row={row}
              languageId={languageId}
              tokenColors={tokenColors}
              renderAbsentLine={false}
            />
            <DiffLine
              pane="new"
              row={row}
              languageId={languageId}
              tokenColors={tokenColors}
              renderAbsentLine={false}
            />
            <AnnotationSlot
              annotations={annotationsByRowIndex.get(rowIndex)}
              rowIndex={rowIndex}
              visible
            />
          </Box>
        );
      })}
    </Box>
  );
};

interface OverviewRulerProps {
  segments: ChangeSegment[];
  totalRows: number;
  onJump: (rowIndex: number) => void;
}

const OverviewRuler: React.FC<OverviewRulerProps> = ({
  segments,
  totalRows,
  onJump,
}) => {
  const theme = useTheme();
  const [height, setHeight] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  // Translate a click on the track into a row index by mapping the click's Y
  // offset within the track to the same fraction of the file. Segments do not
  // own clicks of their own — they sit beneath the track's hit area with
  // pointer-events disabled — so the math is identical whether the user hit a
  // colored mark or empty track between marks.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.height === 0 || totalRows === 0) return;
      const fraction = (e.clientY - rect.top) / rect.height;
      const clampedFraction = Math.min(1, Math.max(0, fraction));
      const targetIndex = Math.min(
        totalRows - 1,
        Math.max(0, Math.floor(clampedFraction * totalRows)),
      );
      onJump(targetIndex);
    },
    [onJump, totalRows],
  );

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setHeight(node.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  const insertColor =
    theme.palette.mode === "dark"
      ? "rgba(46, 160, 67, 0.75)"
      : "rgba(46, 125, 50, 0.65)";
  const deleteColor =
    theme.palette.mode === "dark"
      ? "rgba(248, 81, 73, 0.75)"
      : "rgba(198, 40, 40, 0.65)";

  const safeTotal = Math.max(totalRows, 1);

  return (
    <Box
      ref={ref}
      data-testid="full-file-split-overview-ruler"
      onClick={handleClick}
      sx={{
        position: "relative",
        width: OVERVIEW_RULER_WIDTH_PX,
        flexShrink: 0,
        ml: 0.5,
        borderRadius: 0.5,
        cursor: "pointer",
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(255, 255, 255, 0.04)"
            : "rgba(0, 0, 0, 0.04)",
      }}
    >
      {segments.map((segment, idx) => {
        const startFraction = segment.startIndex / safeTotal;
        const lengthFraction =
          (segment.endIndex - segment.startIndex + 1) / safeTotal;
        const topPx = startFraction * height;
        const heightPx = Math.max(
          OVERVIEW_RULER_MIN_MARK_PX,
          lengthFraction * height,
        );
        const clampedTopPx = Math.min(topPx, Math.max(0, height - heightPx));

        return (
          <Box
            key={idx}
            data-testid={`full-file-split-overview-ruler-segment-${String(
              idx,
            )}`}
            data-start-index={segment.startIndex}
            data-end-index={segment.endIndex}
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${String(clampedTopPx)}px`,
              height: `${String(heightPx)}px`,
              display: "flex",
              pointerEvents: "none",
            }}
          >
            <Box
              data-testid={`full-file-split-overview-ruler-segment-${String(
                idx,
              )}-delete`}
              sx={{
                flex: 1,
                backgroundColor: segment.hasDelete
                  ? deleteColor
                  : "transparent",
              }}
            />
            <Box
              data-testid={`full-file-split-overview-ruler-segment-${String(
                idx,
              )}-insert`}
              sx={{
                flex: 1,
                backgroundColor: segment.hasInsert
                  ? insertColor
                  : "transparent",
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
};

export const FullFileSplitView: React.FC<FullFileSplitViewProps> = ({
  preContent,
  postContent,
  filePath,
  presentationMode,
  hideComments = false,
  annotations,
}) => {
  const theme = useTheme();

  const languageId = useMemo(() => resolvePrismLanguage(filePath), [filePath]);
  const tokenColors = useMemo(
    () => getDiffTokenColors(theme.palette.mode),
    [theme.palette.mode],
  );

  const allRows = useMemo(
    () => buildFullFileSplit(preContent, postContent),
    [preContent, postContent],
  );

  // When comments are hidden, every downstream computation — change segments,
  // the overview ruler and the annotation-by-row-index map — runs against the
  // filtered rows so the ruler and inline annotations stay anchored.
  const rows = useMemo(
    () =>
      hideComments
        ? filterCommentRows(allRows, filePath, preContent, postContent)
        : allRows,
    [hideComments, allRows, filePath, preContent, postContent],
  );

  const segments = useMemo(() => buildChangeSegments(rows), [rows]);
  const firstChangeIndex = segments.length > 0 ? segments[0].startIndex : -1;
  const hasChanges = firstChangeIndex !== -1;

  const annotationsByRowIndex = useMemo(
    () => buildAnnotationsByRowIndex(rows, annotations ?? [], firstChangeIndex),
    [rows, annotations, firstChangeIndex],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const oldPaneRef = useRef<HTMLPreElement | null>(null);
  const newPaneRef = useRef<HTMLPreElement | null>(null);
  const verticalPaneRef = useRef<HTMLPreElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [splitRatio, setSplitRatio] = useState(() => readStoredSplitRatio());
  const dragStateRef = useRef<{
    startX: number;
    startRatio: number;
    containerWidth: number;
  } | null>(null);

  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const containerWidth = gridEl.clientWidth;
      dragStateRef.current = {
        startX: e.clientX,
        startRatio: splitRatio,
        containerWidth,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [splitRatio],
  );

  const handleDividerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaX = e.clientX - drag.startX;
      const ratioDelta = deltaX / drag.containerWidth;
      const next = clampSplitRatio(
        drag.startRatio + ratioDelta,
        drag.containerWidth,
      );
      setSplitRatio(next);
    },
    [],
  );

  const handleDividerPointerUp = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const finalRatio = clampSplitRatio(splitRatio, drag.containerWidth);
    setSplitRatio(finalRatio);
    writeStoredSplitRatio(finalRatio);
    dragStateRef.current = null;
  }, [splitRatio]);

  // The Before/After captions occupy space at the top of the shared scroll
  // container before the panes begin. Measuring that offset once after layout
  // lets the virtualizer line its row offsets up with the scroll position.
  useLayoutEffect(() => {
    const paneEl =
      presentationMode === DIFF_PRESENTATION_MODES.vertical
        ? verticalPaneRef.current
        : oldPaneRef.current;
    if (!paneEl) return;
    setScrollMargin(paneEl.offsetTop);
  }, [presentationMode]);

  // Per-index union of each pane's measured row height. The virtualizer's
  // single measurement per index is the max of the two sides plus the
  // annotation slot, so the Before and After panes always reserve the same
  // vertical band for the row even when one side is much taller.
  const measuredByIndexRef = useRef<
    Map<number, Partial<Record<MeasuredPresentationPane, number>>>
  >(new Map());

  // Smart per-row estimate for indices the virtualizer has not yet measured.
  // Wrap count is approximated from the longer side's length against the
  // ~100-char wrap width, plus the annotation slot's seed height when the row
  // carries one. Without this, the scrollbar grows in big jumps as wrapped or
  // annotated rows mount; with it, the residual correction is small enough
  // that scrolling stays smooth.
  const estimateRowHeight = useCallback(
    (index: number): number => {
      const row = rows[index];
      if (!row) return SINGLE_LINE_HEIGHT_PX;
      const estimateLineWraps = (line: string | null): number =>
        line === null
          ? 0
          : Math.max(1, Math.ceil(line.length / ESTIMATED_CHARS_PER_LINE));
      const oldWraps = estimateLineWraps(row.oldLine);
      const newWraps = estimateLineWraps(row.newLine);
      const wraps =
        presentationMode === DIFF_PRESENTATION_MODES.vertical
          ? oldWraps + newWraps
          : Math.max(1, oldWraps, newWraps);
      let height = wraps * SINGLE_LINE_HEIGHT_PX;
      const annotations = annotationsByRowIndex.get(index);
      if (annotations) {
        height += annotations.length * ANNOTATION_ESTIMATE_PX;
      }
      return height;
    },
    [rows, annotationsByRowIndex, presentationMode],
  );

  const measureElement = useCallback((node: Element): number => {
    const el = node as HTMLElement;
    const indexAttr = el.dataset.index;
    const paneAttr = el.dataset.pane;
    const measuredHeight = el.getBoundingClientRect().height;
    if (
      indexAttr === undefined ||
      (paneAttr !== "old" && paneAttr !== "new" && paneAttr !== "vertical")
    ) {
      return measuredHeight;
    }
    const index = Number(indexAttr);
    const current = measuredByIndexRef.current.get(index) ?? {};
    current[paneAttr] = measuredHeight;
    measuredByIndexRef.current.set(index, current);
    return paneAttr === "vertical"
      ? measuredHeight
      : Math.max(current.old ?? 0, current.new ?? 0);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateRowHeight,
    overscan: 16,
    scrollMargin,
    measureElement,
  });

  // When the row set or its annotations change, prior per-pane heights no
  // longer correspond to the current indices. Clear the cache and ask the
  // virtualizer to recompute from the fresh estimate so old measurements
  // don't bleed into the new layout.
  useEffect(() => {
    measuredByIndexRef.current.clear();
    rowVirtualizer.measure();
  }, [rows, annotationsByRowIndex, presentationMode, rowVirtualizer]);

  // Debounced copy of splitRatio used only as the measurement trigger.
  // During an active drag splitRatio changes on every pointer-move frame;
  // debouncing avoids churning the measureRow ref (and re-calling it for
  // every mounted row) more than once per ~150ms.
  const [measureKey, setMeasureKey] = useState(splitRatio);
  useEffect(() => {
    const id = setTimeout(() => setMeasureKey(splitRatio), 150);
    return () => clearTimeout(id);
  }, [splitRatio]);

  // Re-measure visible rows when pane widths settle. The ref's identity
  // changes with measureKey so React re-calls it for every mounted row,
  // reading the post-wrap height via getBoundingClientRect.
  const measureRow = useCallback(
    (node: HTMLElement | null) => {
      return rowVirtualizer.measureElement(node);
    },
    [rowVirtualizer, measureKey],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // A virtualizer key owns a single observed DOM element, but each paired row
  // has both a Before and an After wrapper. React attaches the Before ref
  // before the complete grid has finished committing, so that first height
  // can reflect the unconstrained line rather than its settled wrapped height.
  // Re-read every mounted pair in a layout effect, once both panes have their
  // rendered widths, and publish the pair's union directly to the shared
  // virtualizer before the browser paints.
  const measureMountedRowPairs = useCallback((): void => {
    const grid = gridRef.current;
    if (!grid) return;

    const mountedRows = new Map<
      number,
      Partial<Record<MeasuredPresentationPane, HTMLElement>>
    >();
    const rowNodes = grid.querySelectorAll<HTMLElement>(
      "[data-index][data-pane]",
    );

    for (const node of rowNodes) {
      const indexAttr = node.dataset.index;
      const pane = node.dataset.pane;
      if (
        indexAttr === undefined ||
        (pane !== "old" && pane !== "new" && pane !== "vertical")
      ) {
        continue;
      }
      const index = Number(indexAttr);
      if (!Number.isInteger(index)) continue;
      const pair = mountedRows.get(index) ?? {};
      pair[pane] = node;
      mountedRows.set(index, pair);
    }

    for (const [index, pair] of mountedRows) {
      const current = measuredByIndexRef.current.get(index) ?? {};
      const measured: Partial<Record<MeasuredPresentationPane, number>> = {
        old: pair.old?.getBoundingClientRect().height ?? current.old,
        new: pair.new?.getBoundingClientRect().height ?? current.new,
        vertical:
          pair.vertical?.getBoundingClientRect().height ?? current.vertical,
      };
      measuredByIndexRef.current.set(index, measured);
      const measuredHeight =
        presentationMode === DIFF_PRESENTATION_MODES.vertical
          ? measured.vertical
          : Math.max(measured.old ?? 0, measured.new ?? 0);
      if (measuredHeight !== undefined) {
        rowVirtualizer.resizeItem(index, measuredHeight);
      }
    }
  }, [presentationMode, rowVirtualizer]);

  useLayoutEffect(() => {
    measureMountedRowPairs();
  }, [measureKey, measureMountedRowPairs, virtualItems]);

  // Container resizes can change pane widths without changing the stored
  // split ratio. Observe both pane roots and remeasure mounted pairs whenever
  // either rendered width changes; row-level observation continues to cover
  // content and annotation height changes.
  useLayoutEffect(() => {
    const paneRoots =
      presentationMode === DIFF_PRESENTATION_MODES.vertical
        ? [verticalPaneRef.current]
        : [oldPaneRef.current, newPaneRef.current];
    if (
      paneRoots.some((pane) => pane === null) ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const widths = new Map<Element, number>();
    const observer = new ResizeObserver((entries) => {
      let widthChanged = false;
      for (const entry of entries) {
        const nextWidth = entry.contentRect.width;
        if (widths.get(entry.target) !== nextWidth) {
          widths.set(entry.target, nextWidth);
          widthChanged = true;
        }
      }
      if (widthChanged) measureMountedRowPairs();
    });
    for (const pane of paneRoots) {
      if (pane) observer.observe(pane);
    }
    return () => observer.disconnect();
  }, [measureMountedRowPairs, presentationMode]);

  // Scroll the diff to the file's first changed row. Routing through the
  // virtualizer's scroll-to-index means the target offset is computed from the
  // estimated row sizes, so it lands correctly even when the first change is
  // thousands of rows down and unmounted at open. The scroll waits until both
  // the shared scroll container and the measured caption offset (scrollMargin)
  // are available so the offset is anchored to the right scroll position. It
  // re-runs when the row set changes — a hide-comments toggle re-derives
  // firstChangeIndex — and does nothing when the file has no changes.
  useEffect(() => {
    if (!hasChanges) return;
    if (!scrollRef.current || scrollMargin === 0) return;
    rowVirtualizer.scrollToIndex(firstChangeIndex, { align: "start" });
  }, [hasChanges, rows, scrollMargin, firstChangeIndex, rowVirtualizer]);

  return (
    <Box
      data-testid="full-file-split-view"
      sx={{
        display: "flex",
        alignItems: "stretch",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Box
        data-testid="full-file-split-view-scroll"
        ref={scrollRef}
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: "auto",
          position: "relative",
        }}
      >
        <Box
          ref={gridRef}
          sx={{
            display: "grid",
            gridTemplateColumns:
              presentationMode === DIFF_PRESENTATION_MODES.sideBySide
                ? `${splitRatio}fr 4px ${1 - splitRatio}fr`
                : "minmax(0, 1fr)",
          }}
        >
          {presentationMode === DIFF_PRESENTATION_MODES.sideBySide ? (
            <SideBySideDiffPresentation
              rows={rows}
              virtualItems={virtualItems}
              totalSize={totalSize}
              scrollMargin={scrollMargin}
              annotationsByRowIndex={annotationsByRowIndex}
              languageId={languageId}
              tokenColors={tokenColors}
              oldPaneRef={oldPaneRef}
              newPaneRef={newPaneRef}
              measureRow={measureRow}
              onDividerPointerDown={handleDividerPointerDown}
              onDividerPointerMove={handleDividerPointerMove}
              onDividerPointerUp={handleDividerPointerUp}
            />
          ) : (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={presentationCaptionSx}>
                Inline
              </Typography>
              <VerticalDiffPresentation
                rows={rows}
                virtualItems={virtualItems}
                totalSize={totalSize}
                scrollMargin={scrollMargin}
                annotationsByRowIndex={annotationsByRowIndex}
                languageId={languageId}
                tokenColors={tokenColors}
                rootRef={verticalPaneRef}
                measureRow={measureRow}
              />
            </Box>
          )}
        </Box>
      </Box>
      {hasChanges ? (
        <OverviewRuler
          segments={segments}
          totalRows={rows.length}
          onJump={(rowIndex) => {
            rowVirtualizer.scrollToIndex(rowIndex, { align: "start" });
          }}
        />
      ) : null}
    </Box>
  );
};
