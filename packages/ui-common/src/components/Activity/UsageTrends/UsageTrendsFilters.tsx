import {
  Checkbox,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  ReportUsageTrendGranularity,
  ReportUsageTrendKind,
  ReportUsageTrendOptions,
} from "../../../api";
import type { UsageTrendsFilterState } from "./usageTrendsState";

export interface UsageTrendsFiltersProps {
  value: UsageTrendsFilterState;
  options: ReportUsageTrendOptions | null;
  onChange: (value: UsageTrendsFilterState) => void;
}

const GRANULARITIES: ReportUsageTrendGranularity[] = ["day", "week", "month"];

interface MultiFilterProps {
  label: string;
  selected: string[];
  available: string[];
  display?: (value: string) => string;
  onChange: (next: string[]) => void;
  testId: string;
}

const MultiFilter = ({
  label,
  selected,
  available,
  display = (value) => value,
  onChange,
  testId,
}: MultiFilterProps) => {
  // Keep selected values selectable even if the current period no longer has them.
  const choices = [...new Set([...available, ...selected])];
  const labelId = `${testId}-label`;

  return (
    <FormControl size="small" sx={{ minWidth: 150 }}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        label={label}
        multiple
        value={selected}
        data-testid={testId}
        onChange={(event) => {
          const next = event.target.value;
          onChange(typeof next === "string" ? next.split(",") : next);
        }}
        renderValue={(values) =>
          values.length === 0 ? "" : values.map(display).join(", ")
        }
      >
        {choices.map((choice) => (
          <MenuItem key={choice} value={choice}>
            <Checkbox checked={selected.includes(choice)} size="small" />
            <ListItemText primary={display(choice)} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export const UsageTrendsFilters = ({
  value,
  options,
  onChange,
}: UsageTrendsFiltersProps) => {
  const { t } = useTranslation();
  const kindLabel = (kind: string) =>
    t(`usageTrends.kind.${kind}`, { defaultValue: kind });
  const unknownAware = (raw: string) =>
    raw === "unknown" ? t("usageTrends.unknown") : raw;

  return (
    <Stack
      direction="row"
      flexWrap="wrap"
      gap={1.5}
      alignItems="center"
      data-testid="usage-trends-filters"
    >
      <TextField
        size="small"
        type="date"
        label={t("usageTrends.from")}
        value={value.from}
        InputLabelProps={{ shrink: true }}
        inputProps={{ "data-testid": "usage-trends-from" }}
        onChange={(event) => onChange({ ...value, from: event.target.value })}
      />
      <TextField
        size="small"
        type="date"
        label={t("usageTrends.to")}
        value={value.to}
        InputLabelProps={{ shrink: true }}
        inputProps={{ "data-testid": "usage-trends-to" }}
        onChange={(event) => onChange({ ...value, to: event.target.value })}
      />
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value.granularity}
        aria-label={t("usageTrends.groupBy")}
        onChange={(_event, next: ReportUsageTrendGranularity | null) => {
          if (next) {
            onChange({ ...value, granularity: next });
          }
        }}
      >
        {GRANULARITIES.map((granularity) => (
          <ToggleButton
            key={granularity}
            value={granularity}
            data-testid={`usage-trends-granularity-${granularity}`}
          >
            {t(`usageTrends.granularity.${granularity}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <MultiFilter
        label={t("usageTrends.reportKind")}
        testId="usage-trends-kinds"
        selected={value.reportKinds}
        available={options?.reportKinds ?? []}
        display={kindLabel}
        onChange={(next) =>
          onChange({ ...value, reportKinds: next as ReportUsageTrendKind[] })
        }
      />
      <MultiFilter
        label={t("usageTrends.provider")}
        testId="usage-trends-providers"
        selected={value.providers}
        available={options?.providers ?? []}
        display={unknownAware}
        onChange={(next) => onChange({ ...value, providers: next })}
      />
      <MultiFilter
        label={t("usageTrends.model")}
        testId="usage-trends-models"
        selected={value.models}
        available={options?.models ?? []}
        onChange={(next) => onChange({ ...value, models: next })}
      />
      <MultiFilter
        label={t("usageTrends.effort")}
        testId="usage-trends-efforts"
        selected={value.efforts}
        available={options?.efforts ?? []}
        display={unknownAware}
        onChange={(next) => onChange({ ...value, efforts: next })}
      />
    </Stack>
  );
};
