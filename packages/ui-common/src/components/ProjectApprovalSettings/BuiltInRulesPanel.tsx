import { Alert, Box, Paper, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  ProjectApprovalPolicyEffectiveRule,
  ProjectApprovalPolicySnapshot,
} from "../../api";
import { ApprovalEffectiveRule } from "./ApprovalEffectiveRule";

/** Read-only view of the rules that ship with Hey Hey. Offers no editing controls. */
export function BuiltInRulesPanel({
  fixed,
  defaults,
  fallback,
}: {
  fixed: ProjectApprovalPolicyEffectiveRule[];
  defaults: ProjectApprovalPolicyEffectiveRule[];
  fallback: ProjectApprovalPolicySnapshot["fallback"];
}) {
  const { t } = useTranslation();
  return (
    <Stack gap={2} data-testid="approval-builtin-panel">
      <Alert severity="info">
        {t(
          "approvalSettings.builtinIntro",
          "These rules come with Hey Hey and are locked.",
        )}
      </Alert>
      <Paper
        variant="outlined"
        sx={{ p: 2 }}
        data-testid="approval-fixed-counts"
      >
        <Typography variant="h6">
          {t("approvalSettings.fixedCounts", "Fixed approval counts")}
        </Typography>
        <Typography variant="body2">
          {t(
            "approvalSettings.fixedCountsHelp",
            "The number of human approvals is set by Hey Hey. The project approval setting does not change it.",
          )}
        </Typography>
        {fixed.map((rule) => (
          <ApprovalEffectiveRule key={rule.order} rule={rule} />
        ))}
      </Paper>
      <Paper
        variant="outlined"
        sx={{ p: 2 }}
        data-testid="approval-standard-defaults"
      >
        <Typography variant="h6">
          {t("approvalSettings.standardDefaults", "Standard defaults")}
        </Typography>
        <Typography variant="body2">
          {t(
            "approvalSettings.standardDefaultsHelp",
            "Built-in rules that apply when no project rule matches.",
          )}
        </Typography>
        {defaults.map((rule) => (
          <ApprovalEffectiveRule key={rule.order} rule={rule} />
        ))}
        <Box data-testid="approval-fallback" sx={{ mt: 2 }}>
          <Typography>
            {t("approvalSettings.fallback", "When no rule matches")}
          </Typography>
          <Typography>{t("approvalSettings.builtin", "Built-in")}</Typography>
          {fallback.requiresProposal ? (
            <>
              <Typography>
                {t("approvalSettings.proposalRequired", "Proposal required")}
                {" · "}
                {t("approvalSettings.count", "Human approvals")}:{" "}
                {fallback.requiredApprovals}
              </Typography>
              <Typography>
                {t(
                  "approvalSettings.credit",
                  "Allow eligible user proposer approval",
                )}
                :{" "}
                {fallback.allowsProposerApproval
                  ? t("approvalSettings.yes", "Yes")
                  : t("approvalSettings.no", "No")}
              </Typography>
            </>
          ) : (
            <Typography>
              {t("approvalSettings.noProposal", "No proposal required")}
            </Typography>
          )}
        </Box>
      </Paper>
    </Stack>
  );
}
