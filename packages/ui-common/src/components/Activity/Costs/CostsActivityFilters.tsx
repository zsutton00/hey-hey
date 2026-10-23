import { Button, Stack, TextField } from "@mui/material";
import type { ChangeEvent } from "react";

export interface CostsActivityFilterDraft {
  activityFrom: string;
  activityTo: string;
  minKnownCostUsd: string;
}

export interface CostsActivityFiltersProps {
  value: CostsActivityFilterDraft;
  onChange: (value: CostsActivityFilterDraft) => void;
}

export const CostsActivityFilters = ({
  value,
  onChange,
}: CostsActivityFiltersProps) => {
  const update =
    (field: keyof CostsActivityFilterDraft) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, [field]: event.target.value });
    };
  const hasFilters =
    value.activityFrom !== "" ||
    value.activityTo !== "" ||
    value.minKnownCostUsd !== "";

  return (
    <Stack
      alignItems={{ xs: "stretch", md: "center" }}
      direction={{ xs: "column", md: "row" }}
      spacing={1.5}
    >
      <TextField
        data-testid="costs-filter-activity-from"
        label="Activity from"
        onChange={update("activityFrom")}
        size="small"
        slotProps={{
          htmlInput: { step: 1 },
          inputLabel: { shrink: true },
        }}
        type="datetime-local"
        value={value.activityFrom}
      />
      <TextField
        data-testid="costs-filter-activity-to"
        label="Activity to"
        onChange={update("activityTo")}
        size="small"
        slotProps={{
          htmlInput: { step: 1 },
          inputLabel: { shrink: true },
        }}
        type="datetime-local"
        value={value.activityTo}
      />
      <TextField
        data-testid="costs-filter-minimum"
        label="Minimum known cost (USD)"
        onChange={update("minKnownCostUsd")}
        size="small"
        slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
        type="number"
        value={value.minKnownCostUsd}
      />
      <Button
        data-testid="costs-filter-clear"
        disabled={!hasFilters}
        onClick={() =>
          onChange({
            activityFrom: "",
            activityTo: "",
            minKnownCostUsd: "",
          })
        }
        size="small"
      >
        Clear
      </Button>
    </Stack>
  );
};
