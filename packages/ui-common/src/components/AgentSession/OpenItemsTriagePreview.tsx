import { Box, Stack, Typography } from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import { useTranslation } from "react-i18next";
import type {
  PreviewRibbon,
  PreviewRow,
  RowChange,
  TriagePreview,
} from "../../data/triage/replay";

/** Fixed row height so ribbons line up with the rows they connect. */
export const PREVIEW_ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
const RIBBON_WIDTH = 90;
const STACK_BELOW = 640;
const NARROW = `@container (max-width: ${STACK_BELOW}px)`;

const changeLabels: Record<RowChange, string> = {
  unchanged: "",
  removed: "Removed",
  grouped: "Moved into a group",
  ungrouped: "Ungrouped",
  reopened: "Reopened",
  tracked: "Tracked",
  promoted: "Moves into Goal",
  goal: "New pinned Goal",
  pending: "",
};

const tint: Record<RowChange, string> = {
  unchanged: "transparent",
  removed: "rgba(211, 47, 47, 0.14)",
  grouped: "rgba(25, 118, 210, 0.14)",
  ungrouped: "rgba(237, 108, 2, 0.14)",
  reopened: "rgba(46, 125, 50, 0.14)",
  tracked: "rgba(2, 136, 209, 0.14)",
  promoted: "rgba(123, 31, 162, 0.14)",
  goal: "rgba(46, 125, 50, 0.14)",
  pending: "transparent",
};

const ribbonColor: Record<RowChange, string> = {
  unchanged: "#9e9e9e",
  removed: "#d32f2f",
  grouped: "#1976d2",
  ungrouped: "#ed6c02",
  reopened: "#2e7d32",
  tracked: "#0288d1",
  promoted: "#7b1fa2",
  goal: "#2e7d32",
  pending: "#9e9e9e",
};

function typeGlyph(entityType: string) {
  return entityType === "GROUP" ? "▾" : entityType.charAt(0);
}

function Row({
  row,
  side,
  indent,
}: {
  row: PreviewRow;
  side: "before" | "after";
  indent: boolean;
}) {
  const { t } = useTranslation();
  const tag = row.isGroup
    ? row.provisional
      ? t("triage.preview.newGroup", "New group")
      : t("triage.preview.group", "Group")
    : (row.note ??
      (row.change === "unchanged" || row.change === "pending"
        ? ""
        : t(`triage.preview.change.${row.change}`, changeLabels[row.change])));
  const detail = row.trackedOn
    ? `${t("triage.preview.trackedOn", "Tracked on")} ${row.trackedOn}`
    : "";
  const dashed = row.change === "pending" || row.provisional;
  const removed = row.change === "removed" || row.change === "promoted";
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      data-testid="triage-preview-row"
      data-side={side}
      data-row-key={row.key}
      data-change={row.change}
      sx={{
        height: PREVIEW_ROW_HEIGHT,
        boxSizing: "border-box",
        px: 1,
        ml: indent ? 2.75 : 0,
        fontSize: 12,
        bgcolor: row.isGroup ? "action.selected" : tint[row.change],
        border: dashed ? 1 : 0,
        borderStyle: "dashed",
        borderColor: "text.disabled",
        overflow: "hidden",
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 15,
          height: 15,
          flexShrink: 0,
          border: 1,
          borderColor: "text.secondary",
          borderRadius: 0.5,
          fontSize: 9,
          lineHeight: "13px",
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        {typeGlyph(row.entityType)}
      </Box>
      {row.pinned && (
        <PushPinIcon
          sx={{ fontSize: 12 }}
          titleAccess={t("triage.preview.pinned", "Pinned")}
        />
      )}
      <Typography
        noWrap
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: row.isGroup ? 13 : 12,
          fontWeight: row.isGroup ? 700 : 400,
          textDecoration: removed ? "line-through" : "none",
          color: removed ? "text.secondary" : "text.primary",
        }}
      >
        {row.title}
      </Typography>
      {detail && (
        <Typography variant="caption" noWrap sx={{ flexShrink: 0 }}>
          {detail}
        </Typography>
      )}
      {tag && (
        <Box
          component="span"
          sx={{
            fontSize: 10,
            px: 0.9,
            borderRadius: 9,
            whiteSpace: "nowrap",
            border: 1,
            borderStyle: row.change === "pending" ? "dashed" : "solid",
            borderColor:
              row.change === "pending"
                ? "text.disabled"
                : ribbonColor[row.change],
            color: "text.primary",
            flexShrink: 0,
          }}
        >
          {tag}
        </Box>
      )}
    </Stack>
  );
}

function Fold({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="triage-preview-unchanged"
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
      {t("triage.preview.unchanged", `▸ ${count} unchanged items`)}
    </Box>
  );
}

function Ribbons({
  ribbons,
  offset,
  rows,
}: {
  ribbons: PreviewRibbon[];
  offset: number;
  rows: number;
}) {
  const mid = (index: number) => (index + offset + 0.5) * PREVIEW_ROW_HEIGHT;
  const height = rows * PREVIEW_ROW_HEIGHT;
  const half = RIBBON_WIDTH / 2;
  return (
    <Box
      aria-hidden
      data-testid="triage-preview-ribbons"
      sx={{
        display: "block",
        pt: `${HEADER_HEIGHT + 1}px`,
        [NARROW]: { display: "none" },
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${RIBBON_WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {offset > 0 && (
          <path
            d={`M0 ${PREVIEW_ROW_HEIGHT / 2} L${RIBBON_WIDTH} ${PREVIEW_ROW_HEIGHT / 2}`}
            fill="none"
            stroke={ribbonColor.unchanged}
            strokeWidth={8}
            opacity={0.35}
          />
        )}
        {ribbons.map((ribbon, index) => {
          const y1 = ribbon.from === null ? null : mid(ribbon.from);
          const y2 = ribbon.to === null ? null : mid(ribbon.to);
          const color = ribbonColor[ribbon.change];
          const dash = ribbon.change === "pending" ? "5 4" : undefined;
          if (y1 !== null && y2 === null) {
            return (
              <g key={index} data-ribbon={ribbon.change}>
                <path
                  d={`M0 ${y1} L${RIBBON_WIDTH - 32} ${y1}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={8}
                  opacity={0.5}
                />
                <text
                  x={RIBBON_WIDTH - 28}
                  y={y1 + 5}
                  fontSize={14}
                  fontWeight={700}
                  fill={color}
                >
                  ✕
                </text>
              </g>
            );
          }
          if (y1 === null || y2 === null) {
            return null;
          }
          return (
            <path
              key={index}
              data-ribbon={ribbon.change}
              d={`M0 ${y1} C ${half} ${y1}, ${half} ${y2}, ${RIBBON_WIDTH} ${y2}`}
              fill="none"
              stroke={color}
              strokeWidth={8}
              strokeDasharray={dash}
              opacity={ribbon.change === "pending" ? 0.4 : 0.5}
            />
          );
        })}
      </svg>
    </Box>
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
  const offset = preview.unchangedCount > 0 ? 1 : 0;
  const rows = Math.max(
    preview.before.length + offset,
    preview.after.length + offset,
    1,
  );
  const afterGroup = new Set(
    preview.after
      .filter((row) => row.groupName && !row.isGroup)
      .map((r) => r.key),
  );
  return (
    <Box
      data-testid="triage-preview"
      sx={{ containerType: "inline-size", minWidth: 0 }}
    >
      <Stack spacing={1}>
        {loading && (
          <Typography variant="body2" color="text.secondary">
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
          >
            ? {note.message}
          </Typography>
        ))}
        <Box
          data-testid="triage-preview-scroll"
          sx={{
            maxHeight: 460,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: `1fr ${RIBBON_WIDTH}px 1fr`,
            [NARROW]: { gridTemplateColumns: "1fr", maxHeight: "none" },
          }}
        >
          <Box
            data-testid="triage-preview-before"
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              minWidth: 0,
              [NARROW]: { mb: 1.5 },
            }}
          >
            <ColumnHeader
              title={t("triage.preview.now", "Open Items now")}
              count={preview.totals.before}
            />
            {preview.unchangedCount > 0 && (
              <Fold count={preview.unchangedCount} />
            )}
            {preview.before.map((row) => (
              <Row key={row.key} row={row} side="before" indent={false} />
            ))}
          </Box>
          <Ribbons ribbons={preview.ribbons} offset={offset} rows={rows} />
          <Box
            data-testid="triage-preview-after"
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              minWidth: 0,
            }}
          >
            <ColumnHeader
              title={t("triage.preview.after", "After accepted suggestions")}
              count={preview.totals.after}
            />
            {preview.unchangedCount > 0 && (
              <Fold count={preview.unchangedCount} />
            )}
            {preview.after.map((row) => (
              <Row
                key={row.key}
                row={row}
                side="after"
                indent={afterGroup.has(row.key)}
              />
            ))}
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}

function ColumnHeader({ title, count }: { title: string; count: number }) {
  return (
    <Box
      sx={{
        height: HEADER_HEIGHT,
        boxSizing: "border-box",
        px: 1.25,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary">
        {count}
      </Typography>
    </Box>
  );
}
