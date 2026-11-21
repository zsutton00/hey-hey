import { Box, Typography } from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type {
  FlowTone,
  LayoutFlow,
  LayoutRow,
  RowMarker,
  TriagePreview,
} from "../../data/triage/replay";

/** Fixed row height so ribbons line up with the rows they connect. */
export const PREVIEW_ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
const GUTTER = 56;
const SCROLL_HEIGHT = 308;
const CHILD_INDENT = 22;
const NARROW = "@container triage-preview (max-width: 800px)";
const WIDE = "@container triage-preview (min-width: 801px)";

type Tone = "removed" | "moved" | "goal" | "new" | "same";

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
    case "pending":
      return "same";
  }
}

const pendingVerbs = {
  removeOpenItems: "✕ Remove",
  reopenItems: "Reopen",
  groupOpenItems: "➜ Group",
  trackOnGoal: "⚑ Track",
  promoteGroupToGoal: "◎ Promote",
} as const;

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
    case "pending":
      return t(
        "triage.preview.marker.pending",
        `${t(`triage.preview.pendingVerb.${marker.verb}`, pendingVerbs[marker.verb])}? not accepted`,
      );
  }
}

function typeGlyph(entityType: string) {
  return entityType.charAt(0);
}

function rowSx(theme: Theme, row: Extract<LayoutRow, { kind: "item" }>) {
  const tint = (tone: Tone) => alpha(toneColor(theme, tone), 0.12);
  const isGoalRow = row.change === "goal";
  const isNew = isGoalRow || (row.isGroup && row.marker?.kind === "newGroup");
  const isGhost = row.change === "pending" && row.key.startsWith("ghost:");
  const isPending = row.change === "pending" && !isGhost;

  const background = isGhost
    ? theme.palette.background.paper
    : row.isGroup && !isGoalRow
      ? row.change === "promoted"
        ? tint("goal")
        : theme.palette.action.selected
      : isGoalRow
        ? tint("goal")
        : row.change === "removed"
          ? tint("removed")
          : row.change === "promoted" || row.change === "tracked"
            ? tint("goal")
            : row.change === "grouped" ||
                row.change === "ungrouped" ||
                row.change === "reopened"
              ? tint("moved")
              : "transparent";

  return {
    bgcolor: background,
    borderRadius: row.isGroup ? 1.5 : 0,
    ...(isNew && {
      outline: `2px solid ${theme.palette.success.main}`,
      outlineOffset: "-2px",
    }),
    ...(isGoalRow && {
      borderLeft: `3px dotted ${theme.palette.secondary.main}`,
    }),
    ...(isPending && { border: `1px dashed ${theme.palette.text.disabled}` }),
    ...(isGhost && { border: `1px dashed ${theme.palette.success.main}` }),
  };
}

function PreviewRowView({
  row,
  side,
}: {
  row: LayoutRow;
  side: "before" | "after";
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
  return (
    <Box
      data-testid="triage-preview-row"
      data-side={side}
      data-row-key={row.key}
      data-change={row.change}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: row.isGroup ? 1 : 0.875,
        height: PREVIEW_ROW_HEIGHT,
        boxSizing: "border-box",
        px: 1,
        ml: `${row.depth * CHILD_INDENT}px`,
        fontSize: 12,
        minWidth: 0,
        ...rowSx(theme, row),
      }}
    >
      {row.isGroup ? (
        <Box
          aria-hidden
          sx={{ width: 12, flexShrink: 0, color: "text.secondary" }}
        >
          ⌄
        </Box>
      ) : (
        <Box
          aria-hidden
          sx={{
            width: 16,
            height: 16,
            flexShrink: 0,
            border: 1,
            borderColor: "text.secondary",
            borderRadius: 0.75,
            bgcolor: "action.selected",
            fontSize: 9,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isGoalRow ? "◎" : typeGlyph(row.entityType)}
        </Box>
      )}
      <Typography
        noWrap
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: row.isGroup ? 13 : 12,
          fontWeight: row.isGroup || isGoalRow ? 700 : 400,
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
  const pending = marker.kind === "pending";
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
        border: `1px ${pending ? "dashed" : "solid"} ${pending ? theme.palette.text.secondary : color}`,
        color: pending ? "text.secondary" : color,
      }}
    >
      {markerLabel(t, marker)}
    </Box>
  );
}

function flowColor(theme: Theme, tone: FlowTone) {
  return toneColor(theme, tone === "pending" ? "same" : tone);
}

function Ribbons({ flows, rows }: { flows: LayoutFlow[]; rows: number }) {
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
          const color = flowColor(theme, flow.tone);
          const common = {
            fill: "none",
            stroke: color,
            strokeWidth: 12,
            opacity: flow.tone === "same" ? 0.35 : 0.5,
            strokeDasharray: flow.dashed ? "5 4" : undefined,
            "data-flow": flow.tone,
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

export interface OpenItemsTriagePreviewProps {
  preview: TriagePreview;
  /** True while the collection the preview needs has not loaded. */
  loading: boolean;
}

/** Render-only before/after comparison; every figure comes from the replay. */
export function OpenItemsTriagePreview({
  preview,
  loading,
}: OpenItemsTriagePreviewProps) {
  const { t } = useTranslation();
  const { layout, totals } = preview;
  const nowTitle = t("triage.preview.now", "Open Items now");
  const afterTitle = t("triage.preview.after", "After accepted suggestions");
  const rows = Math.max(layout.before.length, layout.after.length);

  return (
    <Box
      data-testid="triage-preview"
      sx={{
        containerType: "inline-size",
        containerName: "triage-preview",
        minWidth: 0,
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
          sx={{ mb: 0.5, fontSize: 12 }}
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
          sx={{ mb: 0.5, fontSize: 12 }}
        >
          ? {note.message}
        </Typography>
      ))}
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
          bgcolor: "action.hover",
          minWidth: 0,
          [NARROW]: { border: 0, bgcolor: "transparent" },
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `1fr ${GUTTER}px 1fr`,
            height: HEADER_HEIGHT,
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
            display: "grid",
            gridTemplateColumns: `minmax(0, 1fr) ${GUTTER}px minmax(0, 1fr)`,
            alignItems: "start",
            maxHeight: SCROLL_HEIGHT,
            overflowY: "auto",
            [NARROW]: { display: "block", maxHeight: "none" },
          }}
        >
          <Box data-testid="triage-preview-before" sx={{ minWidth: 0 }}>
            <ColumnTitle title={nowTitle} count={totals.before} narrowOnly />
            {layout.before.map((row) => (
              <PreviewRowView key={row.key} row={row} side="before" />
            ))}
          </Box>
          <Ribbons flows={layout.flows} rows={rows} />
          <Box data-testid="triage-preview-after" sx={{ minWidth: 0 }}>
            <ColumnTitle title={afterTitle} count={totals.after} narrowOnly />
            {layout.after.map((row) => (
              <PreviewRowView key={row.key} row={row} side="after" />
            ))}
          </Box>
        </Box>
        <Typography
          sx={{
            m: 0,
            px: 1.25,
            py: 0.75,
            fontSize: 11,
            color: "text.secondary",
            borderTop: 1,
            borderColor: "divider",
            [NARROW]: { display: "none" },
            [WIDE]: { display: "block" },
          }}
        >
          {t(
            "triage.preview.scrollNote",
            "↕ Both columns and the ribbons scroll together. Every changed row is listed; each unchanged run is one row.",
          )}
        </Typography>
      </Box>
    </Box>
  );
}
