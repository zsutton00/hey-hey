import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectApprovalPolicyEffectiveRule } from "../../api";
import { ApprovalEffectiveRule } from "./ApprovalEffectiveRule";

export interface RuleGroup {
  key: string;
  label: string;
}

/** Project-configured rules grouped by type. The Default group has no type selector. */
export function ProjectRulesPanel({
  groups,
  group,
  onSelectGroup,
  projectRules,
  unavailable,
  canAdd,
  busy,
  onAdd,
  rowActions,
}: {
  groups: RuleGroup[];
  group: string;
  onSelectGroup: (key: string) => void;
  projectRules: ProjectApprovalPolicyEffectiveRule[];
  unavailable: ProjectApprovalPolicyEffectiveRule[];
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
  rowActions: (rule: ProjectApprovalPolicyEffectiveRule) => ReactNode;
}) {
  const { t } = useTranslation();
  const current = groups.find((entry) => entry.key === group);
  return (
    <Stack gap={2} data-testid="approval-project-panel">
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" },
          gap: 2,
        }}
      >
        <Paper
          component="nav"
          aria-label={t("approvalSettings.groups", "Rule groups")}
          variant="outlined"
          sx={{ p: 2 }}
        >
          <Typography variant="h6">
            {t("approvalSettings.groups", "Rule groups")}
          </Typography>
          {groups.map((entry) => {
            const params = new URLSearchParams(window.location.search);
            if (entry.key) {
              params.set("approvalType", entry.key);
            } else {
              params.delete("approvalType");
            }
            return (
              <Button
                data-testid="approval-type-group"
                data-type-key={entry.key}
                key={entry.key}
                href={`?${params.toString()}`}
                aria-current={entry.key === group ? "page" : undefined}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    onSelectGroup(entry.key);
                  }
                }}
                sx={{ display: "block", textAlign: "left" }}
              >
                {entry.label}
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ display: "block" }}
                >
                  {t("approvalSettings.ruleCount", "Rules")}:{" "}
                  {
                    projectRules.filter(
                      (rule) => (rule.conditions.typeKey ?? "") === entry.key,
                    ).length
                  }
                </Typography>
              </Button>
            );
          })}
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            gap={2}
            data-testid="approval-group-heading"
          >
            <Typography variant="h6">
              {current?.label ??
                t(
                  "approvalSettings.unknownGroup",
                  "This type is no longer in the registry. Choose another group.",
                )}
            </Typography>
            {canAdd && current && (
              <Button
                data-testid="approval-add-rule"
                disabled={busy}
                onClick={onAdd}
              >
                {t("approvalSettings.add", "Add rule")}
              </Button>
            )}
          </Stack>
          {current &&
            projectRules
              .filter((rule) => (rule.conditions.typeKey ?? "") === group)
              .map((rule) => (
                <ApprovalEffectiveRule
                  key={rule.order}
                  rule={rule}
                  actions={rowActions(rule)}
                />
              ))}
        </Paper>
      </Box>
      {unavailable.map((rule) => (
        <Paper
          key={rule.order}
          variant="outlined"
          sx={{ p: 2 }}
          data-testid="approval-historical-rule"
        >
          <Typography>
            {t("approvalSettings.historical", "Unavailable type")}
          </Typography>
          <ApprovalEffectiveRule rule={rule} actions={rowActions(rule)} />
        </Paper>
      ))}
    </Stack>
  );
}
