import { Error, Info, Warning } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { CodingPlanDiscrepancy } from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import type { FieldComponentProps } from "./types";

const severityPresentation = {
  high: { Icon: Error, color: "error.main", label: "High" },
  medium: { Icon: Warning, color: "warning.main", label: "Medium" },
  low: { Icon: Info, color: "info.main", label: "Low" },
} satisfies Record<
  CodingPlanDiscrepancy["severity"],
  { Icon: typeof Error; color: string; label: string }
>;

export function CodingPlanDiscrepancyField({ config }: FieldComponentProps) {
  const issue = config.payload as CodingPlanDiscrepancy;
  const { Icon, color, label } = severityPresentation[issue.severity];

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      data-testid="coding-plan-discrepancy"
    >
      <Icon
        titleAccess={`${label} severity`}
        sx={{ color, fontSize: 28, flexShrink: 0, mt: 0.25 }}
      />
      <Stack spacing={1} sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <Typography variant="caption" fontWeight={600}>
          {label}
        </Typography>
        <Typography component="div">
          {renderInlineMentions(issue.discrepancyText)}
        </Typography>
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            What I will do
          </Typography>
          <Typography component="div" variant="body2">
            {renderInlineMentions(issue.reasoning)}
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}
