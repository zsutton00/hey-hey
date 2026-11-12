import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicyValidationIssue,
} from "../../api";
import {
  ProjectApprovalPolicyAction,
  ProjectApprovalPolicyAuthor,
  ProjectApprovalPolicyChangeSelector,
} from "../../api";

type Props = {
  rule: ProjectApprovalPolicyRule;
  index: number;
  priority: number;
  total: number;
  disabled: boolean;
  issues: ProjectApprovalPolicyValidationIssue[];
  onChange: (rule: ProjectApprovalPolicyRule) => void;
  onMove: (index: number) => void;
  onDelete: () => void;
};
export function ApprovalRuleEditor({
  rule,
  index,
  priority,
  total,
  disabled,
  issues,
  onChange,
  onMove,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const errorFor = (field: string) =>
    issues
      .filter((issue) => issue.path === `/rules/${index}/${field}`)
      .map((issue) => issue.message)
      .join(" ");
  const labels = {
    USER: t("approvalSettings.user", "User"),
    AGENT: t("approvalSettings.agent", "Agent"),
    CREATE: t("approvalSettings.createAction", "Create"),
    UPDATE: t("approvalSettings.updateAction", "Update"),
    DELETE: t("approvalSettings.deleteAction", "Delete"),
    STATUS_ONLY: t("approvalSettings.statusOnly", "Status only"),
    CONTENT_CHANGE: t("approvalSettings.contentChange", "Content changes"),
  };
  const selectors = [
    {
      field: "author",
      testId: "approval-rule-author",
      label: t("approvalSettings.author", "Author"),
      values: Object.values(ProjectApprovalPolicyAuthor),
    },
    {
      field: "action",
      testId: "approval-rule-action",
      label: t("approvalSettings.action", "Action"),
      values: Object.values(ProjectApprovalPolicyAction),
    },
    {
      field: "change",
      testId: "approval-rule-change",
      label: t("approvalSettings.change", "Changes"),
      values: Object.values(ProjectApprovalPolicyChangeSelector),
    },
  ] as const;
  return (
    <Box
      data-testid="approval-rule-editor"
      data-rule-index={index}
      sx={{ borderTop: 1, borderColor: "divider", py: 2 }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
        <TextField
          data-testid="approval-rule-priority"
          label={t("approvalSettings.priority", "Global priority")}
          type="number"
          value={priority}
          disabled={disabled}
          slotProps={{
            htmlInput: {
              min: priority - index,
              max: priority - index + total - 1,
            },
          }}
          onChange={(event) => {
            const next = Number(event.target.value) - (priority - index);
            if (Number.isInteger(next) && next >= 0 && next < total) {
              onMove(next);
            }
          }}
        />
        <Button
          data-testid="approval-rule-delete"
          disabled={disabled}
          onClick={onDelete}
        >
          {t("approvalSettings.delete", "Delete rule")}
        </Button>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        {selectors.map(({ field, testId, label, values }) => (
          <TextField
            data-testid={testId}
            key={field}
            select
            label={label}
            value={rule.conditions[field] ?? ""}
            disabled={disabled}
            error={!!errorFor(`conditions/${field}`)}
            helperText={errorFor(`conditions/${field}`)}
            onChange={(event) => {
              const value = values.find(
                (value) => value === event.target.value,
              );
              const conditions = { ...rule.conditions };
              delete conditions[field];
              onChange({
                ...rule,
                conditions: value
                  ? { ...conditions, [field]: value }
                  : conditions,
              });
            }}
          >
            <MenuItem value="">{t("approvalSettings.any", "Any")}</MenuItem>
            {values.map((value) => (
              <MenuItem key={value} value={value}>
                {labels[value]}
              </MenuItem>
            ))}
          </TextField>
        ))}
        <TextField
          data-testid="approval-rule-outcome"
          select
          label={t("approvalSettings.outcome", "Outcome")}
          value={rule.requirement}
          error={!!errorFor("requirement")}
          helperText={errorFor("requirement")}
          disabled={disabled}
          onChange={(event) => {
            const immediate = event.target.value === "IMMEDIATE";
            onChange({
              ...rule,
              requirement: immediate ? "IMMEDIATE" : "PROJECT_REQUIRED",
              requiredApprovals: immediate
                ? 0
                : Math.max(1, rule.requiredApprovals),
            });
          }}
        >
          <MenuItem value="IMMEDIATE">
            {t("approvalSettings.immediate", "Apply immediately")}
          </MenuItem>
          <MenuItem value="PROJECT_REQUIRED">
            {t("approvalSettings.review", "Require human approval")}
          </MenuItem>
        </TextField>
        <TextField
          data-testid="approval-rule-count"
          label={t("approvalSettings.count", "Human approvals")}
          type="number"
          value={
            Number.isNaN(rule.requiredApprovals) ? "" : rule.requiredApprovals
          }
          disabled={disabled || rule.requirement === "IMMEDIATE"}
          error={!!errorFor("requiredApprovals")}
          helperText={errorFor("requiredApprovals")}
          slotProps={{
            htmlInput: {
              min: rule.requirement === "IMMEDIATE" ? 0 : 1,
              max: 2147483647,
              step: 1,
            },
          }}
          onChange={(event) =>
            onChange({
              ...rule,
              requiredApprovals:
                event.target.value === "" ? NaN : Number(event.target.value),
            })
          }
        />
        <FormControlLabel
          label={t(
            "approvalSettings.credit",
            "Allow eligible user proposer approval",
          )}
          control={
            <Checkbox
              data-testid="approval-rule-credit"
              checked={rule.allowsProposerApproval}
              disabled={disabled}
              onChange={(_, checked) =>
                onChange({ ...rule, allowsProposerApproval: checked })
              }
            />
          }
        />
      </Box>
    </Box>
  );
}
