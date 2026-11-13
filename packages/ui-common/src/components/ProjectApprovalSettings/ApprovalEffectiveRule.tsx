import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectApprovalPolicyEffectiveRule } from "../../api";
import { FEATURE_TYPE_KEY } from "./approvalRuleFields";

/** A read-only rule. `actions` is rendered only for rules the viewer may change. */
export function ApprovalEffectiveRule({
  rule,
  actions,
}: {
  rule: ProjectApprovalPolicyEffectiveRule;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const conditions = rule.conditions;
  const any = t("approvalSettings.any", "Any");
  const yes = t("approvalSettings.yes", "Yes");
  const no = t("approvalSettings.no", "No");
  const labels: Record<string, string> = {
    USER: t("approvalSettings.user", "User"),
    AGENT: t("approvalSettings.agent", "Agent"),
    CREATE: t("approvalSettings.createAction", "Create"),
    UPDATE: t("approvalSettings.updateAction", "Update"),
    DELETE: t("approvalSettings.deleteAction", "Delete"),
    STATUS_ONLY: t("approvalSettings.statusOnly", "Status only"),
    CONTENT_CHANGE: t("approvalSettings.contentChange", "Content changes"),
  };
  const labelled = (value: string | undefined) =>
    value === undefined ? any : (labels[value] ?? value);
  const isFeature = conditions.typeKey === FEATURE_TYPE_KEY;
  const topLevelText =
    conditions.topLevel === undefined
      ? any
      : conditions.topLevel
        ? t("approvalSettings.topLevelOnly", "Top-level only")
        : t("approvalSettings.notTopLevel", "Not top-level");
  const fields: [string, string | undefined][] = [
    [t("approvalSettings.type", "Type"), conditions.typeKey],
    [t("approvalSettings.author", "Author"), labelled(conditions.author)],
    [t("approvalSettings.action", "Action"), labelled(conditions.action)],
    [t("approvalSettings.change", "Changes"), labelled(conditions.change)],
    isFeature
      ? [t("approvalSettings.topLevelField", "Top-level"), topLevelText]
      : [
          t("approvalSettings.topLevel", "At top level"),
          conditions.topLevel === undefined
            ? undefined
            : conditions.topLevel
              ? yes
              : no,
        ],
    [
      t("approvalSettings.featureContent", "Feature content changed"),
      conditions.featureContentChange === undefined
        ? undefined
        : conditions.featureContentChange
          ? yes
          : no,
    ],
    [
      t("approvalSettings.authoringTool", "Authoring operation"),
      conditions.toolName,
    ],
  ];
  const descriptions = fields
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label}: ${value}`);
  return (
    <Box
      data-testid="approval-effective-rule"
      sx={{ py: 2, borderTop: 1, borderColor: "divider" }}
    >
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Chip
          label={`${t("approvalSettings.priority", "Global priority")} ${rule.order + 1}`}
        />
        <Chip
          label={
            rule.source === "PROJECT"
              ? t("approvalSettings.projectSource", "Project configuration")
              : rule.source === "FIXED"
                ? t("approvalSettings.fixedSource", "Built-in · Fixed")
                : t("approvalSettings.builtin", "Built-in")
          }
        />
        {actions && <Box sx={{ ml: "auto" }}>{actions}</Box>}
      </Stack>
      <Typography sx={{ mt: 1 }}>{descriptions.join(" · ")}</Typography>
      <Typography>
        {rule.source === "FIXED"
          ? t(
              "approvalSettings.fixedRow",
              "Always requires exactly {{count}} human approval(s). The project's approval setting does not change it.",
              { count: rule.requiredApprovals },
            )
          : rule.requirement === "IMMEDIATE"
            ? t("approvalSettings.immediate", "Apply immediately")
            : `${t("approvalSettings.count", "Human approvals")}: ${rule.requiredApprovals}`}
      </Typography>
      <Typography variant="body2">
        {t("approvalSettings.credit", "Allow eligible user proposer approval")}:{" "}
        {rule.allowsProposerApproval ? yes : no}
      </Typography>
    </Box>
  );
}
