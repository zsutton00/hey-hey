import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { openItemIconSubject } from "../../data/openItemsMapping";
import type {
  FlowTone,
  LayoutFlow,
  LayoutRow,
  RowMarker,
  TriagePreview,
} from "../../data/triage/replay";
import {
  OpenItemIcon,
  type WorkItemIconRegistry,
} from "../Entity/OpenItemIcon";

/** Fixed row height so ribbons line up with the rows they connect. */
export const PREVIEW_ROW_HEIGHT = 32;
const HEADER_HEIGHT = 32;
const GUTTER = 56;
/** Matches the Open Items sidebar's per-level indent. */
const CHILD_INDENT = 20;
/** The review's own container: the modal's content width. */
export const TRIAGE_REVIEW_CONTAINER = "triage-review";
const NARROW = `@container ${TRIAGE_REVIEW_CONTAINER} (max-width: 800px)`;

type Tone = FlowTone;

function toneColor(theme: Theme, tone: Tone) {
  switch (tone) {
    case "removed":
      return theme.palette.error.main;
    case "moved":
      return theme.palette.info.main;
    case "goal":
      return theme.palette.secondary.main;
    case "new":
      return theme.palette.success.main;
    case "same":
      return theme.palette.text.disabled;
  }
}

function markerTone(marker: RowMarker): Tone {
  switch (marker.kind) {
    case "remove":
      return "removed";
    case "group":
    case "ungrouped":
      return "moved";
    case "promoteGroup":
    case "goalLeaves":
    case "tracked":
      return "goal";
    case "newGroup":
    case "pinnedGoal":
    case "reopened":
      return "new";
  }
}

function markerLabel(
  t: ReturnType<typeof useTranslation>["t"],
  marker: RowMarker,
) {
  switch (marker.kind) {
    case "remove":
      return t("triage.preview.marker.remove", "✕ Remove");
    case "group":
      return t("triage.preview.marker.group", "➜ Group");
    case "ungrouped":
      return t("triage.preview.marker.ungrouped", "↩ Ungrouped");
    case "reopened":
      return t("triage.preview.marker.reopened", "＋ Reopened");
    case "promoteGroup":
      return t("triage.preview.marker.promoteGroup", "◎ Promote to Goal");
    case "goalLeaves":
      return t("triage.preview.marker.goalLeaves", "→ Goal, leaves");
    case "tracked":
      return t("triage.preview.marker.tracked", `⚑ Tracked on ${marker.goal}`);
    case "newGroup":
      return t(
        "triage.preview.marker.newGroup",
        `＋ New group · ${marker.count} ${marker.count === 1 ? "item" : "items"}`,
      );
    case "pinnedGoal":
      return t("triage.preview.marker.pinnedGoal", "＋ Pinned Goal · preview");
  }
}

function rowBackground(
  theme: Theme,
  row: Extract<LayoutRow, { kind: "item" }>,
) {
  const tint = (tone: Tone) => alpha(toneColor(theme, tone), 0.12);
  switch (row.change) {
    case "removed":
      return tint("removed");
    case "promoted":
    case "tracked":
    case "goal":
      return tint("goal");
    case "grouped":
    case "ungrouped":
    case "reopened":
      return row.isGroup ? theme.palette.action.hover : tint("moved");
    case "unchanged":
      return row.isGroup ? theme.palette.action.hover : "transparent";
  }
}

function PreviewRowView({
  row,
  side,
  highlighted,
  registry,
}: {
  row: LayoutRow;
  side: "before" | "after";
  highlighted: boolean;
  registry: WorkItemIconRegistry;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (row.kind === "fold") {
    return (
      <Box
        data-testid="triage-preview-unchanged"
        data-side={side}
        data-count={row.count}
        sx={{
          height: PREVIEW_ROW_HEIGHT,
          boxSizing: "border-box",
          px: 1,
          display: "flex",
          alignItems: "center",
          fontSize: 11,
          color: "text.secondary",
          bgcolor: "action.hover",
        }}
      >
        {t(
          "triage.preview.unchanged",
          `▸ ${row.count} unchanged ${row.count === 1 ? "item" : "items"}`,
        )}
      </Box>
    );
  }

  const struck = row.change === "removed";
  const isGoalRow = row.change === "goal";
  const isNew = isGoalRow || row.marker?.kind === "newGroup";
  const iconSubject =
    row.entityType === "GROUP"
      ? null
      : openItemIconSubject(row.entityType, row.presentation);

  return (
    <Box
      data-testid="triage-preview-row"
      data-side={side}
      data-row-key={row.key}
      data-change={row.change}
      data-suggestion-id={row.suggestionId ?? undefined}
      data-highlighted={highlighted}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        height: PREVIEW_ROW_HEIGHT,
        boxSizing: "border-box",
        px: 1,
        ml: `${row.depth * CHILD_INDENT}px`,
        minWidth: 0,
        bgcolor: rowBackground(theme, row),
        borderRadius: row.isGroup ? 1 : 0,
        ...(isNew && {
          outline: `2px solid ${theme.palette.success.main}`,
          outlineOffset: "-2px",
        }),
        ...(isGoalRow && {
          borderLeft: `3px dotted ${theme.palette.secondary.main}`,
        }),
        ...(highlighted && {
          boxShadow: `inset 0 0 0 2px ${theme.palette.warning.main}`,
        }),
      }}
    >
      {row.isGroup ? (
        <ExpandMoreIcon
          aria-hidden
          fontSize="small"
          sx={{ color: "text.secondary", flexShrink: 0 }}
        />
      ) : (
        <Box
          data-testid="triage-preview-icon"
          sx={{
            width: 24,
            height: 24,
            flex: "0 0 24px",
            display: "inline-flex",
          }}
        >
          {iconSubject && (
            <OpenItemIcon
              entityType={iconSubject.entityType}
              presentation={iconSubject.presentation}
              registry={registry}
            />
          )}
        </Box>
      )}
      <Typography
        variant="body2"
        noWrap
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: "0.875rem",
          fontWeight: row.isGroup || isGoalRow ? 600 : 400,
          textDecoration: struck ? "line-through" : "none",
          color: struck ? "text.secondary" : "text.primary",
        }}
      >
        {row.title}
      </Typography>
      {row.marker && <Marker marker={row.marker} />}
    </Box>
  );
}

function Marker({ marker }: { marker: RowMarker }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const color = toneColor(theme, markerTone(marker));
  return (
    <Box
      component="span"
      data-testid="triage-preview-marker"
      data-marker={marker.kind}
      sx={{
        fontSize: 10,
        px: 0.875,
        py: "1px",
        borderRadius: 9,
        whiteSpace: "nowrap",
        flexShrink: 0,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {markerLabel(t, marker)}
    </Box>
  );
}

function Ribbons({
  flows,
  rows,
  highlightedId,
}: {
  flows: LayoutFlow[];
  rows: number;
  highlightedId: string | null;
}) {
  const theme = useTheme();
  const height = Math.max(rows, 1) * PREVIEW_ROW_HEIGHT;
  const mid = (index: number) => (index + 0.5) * PREVIEW_ROW_HEIGHT;
  const half = GUTTER / 2;

  return (
    <Box
      aria-hidden
      data-testid="triage-preview-ribbons"
      sx={{ [NARROW]: { display: "none" } }}
    >
      <svg
        width={GUTTER}
        height={height}
        viewBox={`0 0 ${GUTTER} ${height}`}
        style={{ display: "block" }}
      >
        {flows.map((flow, index) => {
          const color = toneColor(theme, flow.tone);
          const highlighted =
            highlightedId !== null && flow.suggestionId === highlightedId;
          const common = {
            fill: "none",
            stroke: color,
            strokeWidth: 12,
            opacity: highlighted ? 0.85 : flow.tone === "same" ? 0.3 : 0.45,
            "data-flow": flow.tone,
            "data-highlighted": highlighted,
          };
          if (flow.from !== null && flow.to === null) {
            const y = mid(flow.from);
            return (
              <g key={index}>
                <path d={`M0,${y} L36,${y}`} {...common} />
                <text
                  x={40}
                  y={y + 5}
                  fill={color}
                  style={{ font: "700 13px system-ui" }}
                >
                  ✕
                </text>
              </g>
            );
          }
          if (flow.from === null && flow.to !== null) {
            const y = mid(flow.to);
            return (
              <path key={index} d={`M30,${y} L${GUTTER},${y}`} {...common} />
            );
          }
          if (flow.from === null || flow.to === null) {
            return null;
          }
          const y1 = mid(flow.from);
          const y2 = mid(flow.to);
          return (
            <path
              key={index}
              d={`M0,${y1} C${half},${y1} ${half},${y2} ${GUTTER},${y2}`}
              {...common}
            />
          );
        })}
      </svg>
    </Box>
  );
}

function ColumnTitle({
  title,
  count,
  narrowOnly,
}: {
  title: string;
  count: number;
  narrowOnly?: boolean;
}) {
  return (
    <Typography
      component="h3"
      sx={{
        fontSize: 13,
        fontWeight: 700,
        px: 1.25,
        ...(narrowOnly && {
          display: "none",
          fontSize: 12,
          px: 0,
          mt: 1.25,
          mb: 0.5,
          [NARROW]: { display: "block" },
        }),
      }}
    >
      {title}
      <Box
        component="small"
        sx={{ fontWeight: 400, color: "text.secondary", ml: 0.75 }}
      >
        {count}
      </Box>
    </Typography>
  );
}

/** The hovered suggestion, and whether it is checked (only then does it
 * reach the right column and the ribbons). */
export interface TriagePreviewHighlight {
  suggestionId: string;
  selected: boolean;
}

export interface OpenItemsTriagePreviewProps {
  preview: TriagePreview;
  /** True while the collection the preview needs has not loaded. */
  loading: boolean;
  highlight: TriagePreviewHighlight | null;
  registry: WorkItemIconRegistry;
}

/**
 * Render-only before/after comparison; every figure comes from the replay.
 * It fills the height it is given: both columns and the ribbons share one
 * scroll area below the column headers.
 */
export function OpenItemsTriagePreview({
  preview,
  loading,
  highlight,
  registry,
}: OpenItemsTriagePreviewProps) {
  const { t } = useTranslation();
  const { layout, totals } = preview;
  const nowTitle = t("triage.preview.now", "Open Items now");
  const afterTitle = t("triage.preview.after", "After selected suggestions");
  const rows = Math.max(layout.before.length, layout.after.length);
  const beforeHighlight = highlight?.suggestionId ?? null;
  const afterHighlight = highlight?.selected ? highlight.suggestionId : null;

  return (
    <Box
      data-testid="triage-preview"
      sx={{
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        [NARROW]: { display: "block" },
      }}
    >
      {loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t(
            "triage.preview.loading",
            "Open Items must finish loading before changes can be previewed.",
          )}
        </Typography>
      )}
      {preview.warnings.map((warning, index) => (
        <Typography
          key={index}
          variant="body2"
          color="warning.main"
          data-testid="triage-preview-warning"
          sx={{ mb: 0.5, fontSize: 12, flexShrink: 0 }}
        >
          ⚠ {warning.message}
        </Typography>
      ))}
      {preview.unverified.map((note) => (
        <Typography
          key={note.suggestionId}
          variant="body2"
          color="text.secondary"
          data-testid="triage-preview-unverified"
          sx={{ mb: 0.5, fontSize: 12, flexShrink: 0 }}
        >
          ? {note.message}
        </Typography>
      ))}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
          bgcolor: "action.hover",
          minWidth: 0,
          [NARROW]: { display: "block", border: 0, bgcolor: "transparent" },
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `1fr ${GUTTER}px 1fr`,
            height: HEADER_HEIGHT,
            flexShrink: 0,
            alignItems: "center",
            borderBottom: 1,
            borderColor: "divider",
            [NARROW]: { display: "none" },
          }}
        >
          <ColumnTitle title={nowTitle} count={totals.before} />
          <span />
          <ColumnTitle title={afterTitle} count={totals.after} />
        </Box>
        <Box
          data-testid="triage-preview-scroll"
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: `minmax(0, 1fr) ${GUTTER}px minmax(0, 1fr)`,
            alignItems: "start",
            alignContent: "start",
            overflowY: "auto",
            [NARROW]: { display: "block", overflowY: "visible" },
          }}
        >
          <Box data-testid="triage-preview-before" sx={{ minWidth: 0 }}>
            <ColumnTitle title={nowTitle} count={totals.before} narrowOnly />
            {layout.before.map((row) => (
              <PreviewRowView
                key={row.key}
                row={row}
                side="before"
                registry={registry}
                highlighted={
                  row.kind === "item" &&
                  beforeHighlight !== null &&
                  row.suggestionId === beforeHighlight
                }
              />
            ))}
          </Box>
          <Ribbons
            flows={layout.flows}
            rows={rows}
            highlightedId={afterHighlight}
          />
          <Box data-testid="triage-preview-after" sx={{ minWidth: 0 }}>
            <ColumnTitle title={afterTitle} count={totals.after} narrowOnly />
            {layout.after.map((row) => (
              <PreviewRowView
                key={row.key}
                row={row}
                side="after"
                registry={registry}
                highlighted={
                  row.kind === "item" &&
                  afterHighlight !== null &&
                  row.suggestionId === afterHighlight
                }
              />
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
