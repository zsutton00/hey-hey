import { Box, Chip, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ProjectApprovalPolicyEffectiveRule } from "../../api";

export function ApprovalEffectiveRule({
  rule,
}: {
  rule: ProjectApprovalPolicyEffectiveRule;
}) {
  const { t } = useTranslation();
  const conditions = rule.conditions;
  const fields = [
    [t("approvalSettings.type", "Type"), conditions.typeKey],
    [t("approvalSettings.author", "Author"), conditions.author],
    [t("approvalSettings.action", "Action"), conditions.action],
    [t("approvalSettings.change", "Changes"), conditions.change],
    [
      t("approvalSettings.featureContent", "Feature content changed"),
      conditions.featureContentChange,
    ],
    [t("approvalSettings.topLevel", "At top level"), conditions.topLevel],
    [
      t("approvalSettings.authoringTool", "Authoring operation"),
      conditions.toolName,
    ],
  ];
  const yes = t("approvalSettings.yes", "Yes");
  const no = t("approvalSettings.no", "No");
  const descriptions = fields
    .filter(([, value]) => value !== undefined)
    .map(
      ([label, value]) =>
        `${label}: ${value === true ? yes : value === false ? no : value}`,
    );
  return (
    <Box
      data-testid="approval-effective-rule"
      sx={{ py: 2, borderTop: 1, borderColor: "divider" }}
    >
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Chip
          label={`${t("approvalSettings.priority", "Global priority")} ${rule.order + 1}`}
        />
        <Chip
          label={
            rule.source === "PROJECT"
              ? t("approvalSettings.projectSource", "Project configuration")
              : rule.source === "FIXED"
                ? t("approvalSettings.fixed", "Fixed requirement · Locked")
                : t("approvalSettings.builtin", "Built-in default")
          }
        />
      </Stack>
      <Typography sx={{ mt: 1 }}>
        {descriptions.join(" · ") || t("approvalSettings.any", "Any")}
      </Typography>
      <Typography>
        {rule.requirement === "IMMEDIATE"
          ? t("approvalSettings.immediate", "Apply immediately")
          : `${t("approvalSettings.count", "Human approvals")}: ${rule.requiredApprovals}`}
      </Typography>
      <Typography variant="body2">
        {t("approvalSettings.credit", "Allow eligible user proposer approval")}:{" "}
        {rule.allowsProposerApproval
          ? t("approvalSettings.yes", "Yes")
          : t("approvalSettings.no", "No")}
      </Typography>
    </Box>
  );
}
