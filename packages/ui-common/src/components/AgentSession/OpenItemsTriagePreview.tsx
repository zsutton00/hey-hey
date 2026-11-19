import { Box, Paper, Stack, Typography } from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import { useTranslation } from "react-i18next";
import type {
  PreviewRibbon,
  PreviewRow,
  RowChange,
  TriagePreview,
} from "../../data/triage/replay";

export const PREVIEW_ROW_HEIGHT = 40;
const RIBBON_WIDTH = 96;
const NARROW = "@container (max-width: 720px)";

const changeLabels: Record<RowChange, string> = {
  unchanged: "Unchanged",
  removed: "Removed",
  grouped: "Grouped",
  ungrouped: "Ungrouped",
  reopened: "Reopened",
  tracked: "Tracked",
  promoted: "Moves into Goal",
  goal: "New pinned Goal",
};

const changeColors: Record<RowChange, string> = {
  unchanged: "text.disabled",
  removed: "error.main",
  grouped: "primary.main",
  ungrouped: "warning.main",
  reopened: "success.main",
  tracked: "info.main",
  promoted: "secondary.main",
  goal: "secondary.main",
};

function Row({ row, side }: { row: PreviewRow; side: "before" | "after" }) {
  const { t } = useTranslation();
  const label = row.isGroup
    ? row.provisional
      ? t("triage.preview.newGroup", "New group")
      : t("triage.preview.group", "Group")
    : t(`triage.preview.change.${row.change}`, changeLabels[row.change]);
  const detail = row.trackedOn
    ? ` · ${t("triage.preview.trackedOn", "tracked on")} ${row.trackedOn}`
    : row.groupName && !row.isGroup
      ? ` · ${row.groupName}`
      : "";
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      data-testid="triage-preview-row"
      data-side={side}
      data-row-key={row.key}
      data-change={row.change}
      sx={{
        height: PREVIEW_ROW_HEIGHT,
        px: 1,
        borderBottom: 1,
        borderColor: "divider",
        borderLeft: 3,
        borderLeftColor: changeColors[row.change],
        borderLeftStyle: row.provisional ? "dashed" : "solid",
        overflow: "hidden",
      }}
    >
      {row.pinned && (
        <PushPinIcon
          fontSize="inherit"
          titleAccess={t("triage.preview.pinned", "Pinned")}
        />
      )}
      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {row.title}
      </Typography>
      <Typography
        variant="caption"
        noWrap
        sx={{ color: changeColors[row.change], flexShrink: 0 }}
      >
        {label}
        {detail}
      </Typography>
    </Stack>
  );
}

function Collapsed({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="triage-preview-unchanged"
      sx={{
        height: PREVIEW_ROW_HEIGHT,
        px: 1.5,
        display: "flex",
        alignItems: "center",
        borderBottom: 1,
        borderColor: "divider",
        color: "text.secondary",
      }}
    >
      <Typography variant="body2">
        {t("triage.preview.unchanged", `${count} unchanged`)}
      </Typography>
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
  return (
    <Box
      aria-hidden
      data-testid="triage-preview-ribbons"
      sx={{ display: "block", [NARROW]: { display: "none" } }}
    >
      <svg
        width={RIBBON_WIDTH}
        height={height}
        viewBox={`0 0 ${RIBBON_WIDTH} ${height}`}
        style={{ display: "block" }}
      >
        {offset > 0 && (
          <line
            x1={0}
            x2={RIBBON_WIDTH}
            y1={PREVIEW_ROW_HEIGHT / 2}
            y2={PREVIEW_ROW_HEIGHT / 2}
            stroke="currentColor"
            opacity={0.25}
            strokeWidth={2}
          />
        )}
        {ribbons.map((ribbon, index) => {
          const y1 = ribbon.from === null ? null : mid(ribbon.from);
          const y2 = ribbon.to === null ? null : mid(ribbon.to);
          const color = "currentColor";
          if (y1 !== null && y2 === null) {
            return (
              <g key={index} data-ribbon={ribbon.change} color="#d32f2f">
                <line
                  x1={0}
                  x2={RIBBON_WIDTH - 14}
                  y1={y1}
                  y2={y1}
                  stroke={color}
                  strokeWidth={2}
                />
                <text
                  x={RIBBON_WIDTH - 12}
                  y={y1 + 5}
                  fontSize={14}
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
          const half = RIBBON_WIDTH / 2;
          return (
            <path
              key={index}
              data-ribbon={ribbon.change}
              d={`M0 ${y1} C ${half} ${y1}, ${half} ${y2}, ${RIBBON_WIDTH} ${y2}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={0.5}
              color="#1976d2"
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
  const { totals } = preview;
  return (
    <Paper
      variant="outlined"
      data-testid="triage-preview"
      sx={{ p: 1.5, containerType: "inline-size" }}
    >
      <Stack spacing={1.5}>
        <Typography
          variant="body2"
          data-testid="triage-preview-summary"
          aria-live="polite"
        >
          {t(
            "triage.preview.summary",
            `Open Items: ${totals.before} now, ${totals.after} after accepted suggestions · ${totals.groupsCreated} groups created · ${totals.removed} removed`,
          )}
        </Typography>
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
            maxHeight: 420,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: `1fr ${RIBBON_WIDTH}px 1fr`,
            [NARROW]: { gridTemplateColumns: "1fr", maxHeight: "none" },
          }}
        >
          <Box data-testid="triage-preview-before">
            <Typography
              variant="overline"
              sx={{ display: "block", height: 20, lineHeight: "20px" }}
            >
              {t("triage.preview.now", "Open Items now")}
            </Typography>
            {preview.unchangedCount > 0 && (
              <Collapsed count={preview.unchangedCount} />
            )}
            {preview.before.map((row) => (
              <Row key={row.key} row={row} side="before" />
            ))}
          </Box>
          <Box sx={{ pt: "20px" }}>
            <Ribbons ribbons={preview.ribbons} offset={offset} rows={rows} />
          </Box>
          <Box data-testid="triage-preview-after">
            <Typography
              variant="overline"
              sx={{ display: "block", height: 20, lineHeight: "20px" }}
            >
              {t("triage.preview.after", "Open Items after accepted")}
            </Typography>
            {preview.unchangedCount > 0 && (
              <Collapsed count={preview.unchangedCount} />
            )}
            {preview.after.map((row) => (
              <Row key={row.key} row={row} side="after" />
            ))}
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
