import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { useProjectCapabilities } from "../../hooks/auth/useProjectCapabilities";
import { ApprovalRuleEditor } from "./ApprovalRuleEditor";
import { ApprovalEffectiveRule } from "./ApprovalEffectiveRule";
import { useApprovalPolicyDraft } from "./useApprovalPolicyDraft";

export function ProjectApprovalSettings({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const draft = useApprovalPolicyDraft(organizationId, projectId);
  const catalog = useWorkItemTypes(organizationId, {
    projectId,
    status: "ACTIVE",
  });
  const { manageApprovalPolicy } = useProjectCapabilities(
    organizationId,
    projectId,
  );
  const [group, setGroup] = useQueryState(
    "approvalType",
    parseAsString.withDefault(""),
  );
  const { policy, rules } = draft;
  const handleRefresh = () => {
    void Promise.allSettled([policy.refetch(), catalog.refetch()]);
  };
  if (
    !policy.data ||
    (!catalog.isReady && catalog.workItemTypes.length === 0)
  ) {
    if (policy.error || catalog.error) {
      return (
        <Alert severity="error">
          {t("approvalSettings.loadError", "Could not load approval settings.")}
          <Button data-testid="approval-retry-load" onClick={handleRefresh}>
            {t("approvalSettings.retry", "Try again")}
          </Button>
        </Alert>
      );
    }
    return (
      <CircularProgress
        aria-label={t("approvalSettings.loading", "Loading approval settings")}
      />
    );
  }
  const snapshot = policy.data;
  const displayedRules = draft.displayedRules;
  const fixed = displayedRules.filter((rule) => rule.source === "FIXED");
  const defaults = displayedRules.filter((rule) => rule.source === "DEFAULT");
  const groups = [
    {
      key: "",
      label: t("approvalSettings.defaultGroup", "Default · All types"),
    },
    ...catalog.workItemTypes.map(({ definition }) => ({
      key: definition.key,
      label: definition.name,
    })),
  ];
  const current = groups.find((entry) => entry.key === group);
  const busy = draft.isPending;
  const handleAdd = () =>
    draft.update([
      ...rules,
      {
        conditions: group ? { typeKey: group } : {},
        requirement: "PROJECT_REQUIRED",
        requiredApprovals: 1,
        allowsProposerApproval: false,
      },
    ]);
  const handleMove = (index: number, next: number) => {
    const ordered = [...rules];
    const [rule] = ordered.splice(index, 1);
    ordered.splice(next, 0, rule);
    draft.update(ordered);
  };
  return (
    <Stack data-testid="project-approval-settings" gap={2}>
      <Typography variant="h5">
        {t("approvalSettings.title", "Approval rules")}
      </Typography>
      <Typography>
        {t(
          "approvalSettings.intro",
          "Choose when changes apply immediately and when people review them.",
        )}
      </Typography>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Typography>
          {draft.dirty
            ? t("approvalSettings.unsaved", "Unsaved changes")
            : t("approvalSettings.saved", "Current settings")}
        </Typography>
        {manageApprovalPolicy && (
          <>
            <Button
              data-testid="approval-save"
              variant="contained"
              disabled={busy || !draft.dirty || draft.failure === "conflict"}
              onClick={() => void draft.save()}
            >
              {t("approvalSettings.save", "Save changes")}
            </Button>
            <Button
              data-testid="approval-restore"
              disabled={busy || draft.failure === "conflict"}
              onClick={() => void draft.save(true)}
            >
              {t("approvalSettings.restore", "Restore defaults")}
            </Button>
            <Button
              data-testid="approval-discard"
              disabled={busy || !draft.dirty}
              onClick={draft.discard}
            >
              {t("approvalSettings.discard", "Discard edits")}
            </Button>
          </>
        )}
        {busy && <CircularProgress size={24} />}
      </Stack>
      <Alert severity="info">
        {t(
          "approvalSettings.orderHelp",
          "Grouped by type. Evaluated by global priority. Saved priorities come from the API. Unsaved edits preview fixed requirements first, then project rules, then built-in defaults. The first matching rule wins. Grouping never changes matching order.",
        )}
      </Alert>
      {(policy.error || catalog.error) && (
        <Alert severity="error">
          {t(
            "approvalSettings.refreshError",
            "Could not refresh settings. Your edits are preserved.",
          )}
          <Button data-testid="approval-retry-refresh" onClick={handleRefresh}>
            {t("approvalSettings.retry", "Try again")}
          </Button>
        </Alert>
      )}
      {draft.failure && (
        <Alert severity="error" data-testid="approval-save-error">
          {draft.failure === "conflict"
            ? t(
                "approvalSettings.conflict",
                "Someone saved newer settings. Your edits are preserved. Read and review the latest settings before deliberately retrying.",
              )
            : t(
                "approvalSettings.saveError",
                "Could not save changes. Your edits are preserved. Correct any errors and try again.",
              )}
          {draft.failure === "conflict" && (
            <Button
              data-testid="approval-review-latest"
              disabled={policy.isFetching}
              onClick={() => void draft.reviewLatest()}
            >
              {t("approvalSettings.reviewLatest", "Review latest settings")}
            </Button>
          )}
        </Alert>
      )}
      {draft.issues.length > 0 && (
        <Alert severity="error">
          <ul>
            {draft.issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {draft.latest && (
        <Paper
          variant="outlined"
          sx={{ p: 2 }}
          data-testid="approval-latest-settings"
        >
          <Typography variant="h6">
            {t("approvalSettings.latest", "Latest saved settings")}
          </Typography>
          {draft.latest.rules.map((rule) => (
            <ApprovalEffectiveRule key={rule.order} rule={rule} />
          ))}
          <Button
            data-testid="approval-accept-revision"
            onClick={draft.acceptRevision}
          >
            {t(
              "approvalSettings.acceptRevision",
              "I reviewed these settings. Keep my edits for a deliberate retry.",
            )}
          </Button>
        </Paper>
      )}
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
                    void setGroup(entry.key, { history: "push" });
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
                  {rules.filter(
                    (rule) => (rule.conditions.typeKey ?? "") === entry.key,
                  ).length +
                    defaults.filter(
                      (rule) => (rule.conditions.typeKey ?? "") === entry.key,
                    ).length}
                </Typography>
              </Button>
            );
          })}
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
          <Typography variant="h6">
            {current?.label ??
              t(
                "approvalSettings.unknownGroup",
                "This type is no longer in the registry. Choose another group.",
              )}
          </Typography>
          {manageApprovalPolicy && current && (
            <Button
              data-testid="approval-add-rule"
              onClick={handleAdd}
              disabled={busy}
            >
              {t("approvalSettings.add", "Add rule")}
            </Button>
          )}
          {rules.map(
            (rule, index) =>
              (rule.conditions.typeKey ?? "") === group &&
              current && (
                <Box key={index}>
                  <Typography variant="body2">
                    {t(
                      "approvalSettings.projectSource",
                      "Project configuration",
                    )}
                  </Typography>
                  <ApprovalRuleEditor
                    rule={rule}
                    index={index}
                    priority={fixed.length + index + 1}
                    total={rules.length}
                    disabled={!manageApprovalPolicy || busy || !current}
                    issues={draft.issues}
                    onChange={(next) =>
                      draft.update(
                        rules.map((rule, position) =>
                          position === index ? next : rule,
                        ),
                      )
                    }
                    onDelete={() =>
                      draft.update(
                        rules.filter((_, position) => position !== index),
                      )
                    }
                    onMove={(next) => handleMove(index, next)}
                  />
                </Box>
              ),
          )}
          {defaults
            .filter((rule) => (rule.conditions.typeKey ?? "") === group)
            .map((rule) => (
              <ApprovalEffectiveRule key={rule.order} rule={rule} />
            ))}
        </Paper>
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">
          {t("approvalSettings.fixed", "Fixed requirement · Locked")}
        </Typography>
        {fixed.map((rule) => (
          <ApprovalEffectiveRule key={rule.order} rule={rule} />
        ))}
        <Typography variant="h6">
          {t("approvalSettings.otherBuiltins", "Other built-in rules · Locked")}
        </Typography>
        {defaults
          .filter(
            (rule) =>
              rule.conditions.typeKey &&
              !groups.some((entry) => entry.key === rule.conditions.typeKey),
          )
          .map((rule) => (
            <ApprovalEffectiveRule key={rule.order} rule={rule} />
          ))}
        <Box data-testid="approval-fallback">
          <Typography>
            {t("approvalSettings.fallback", "When no rule matches")}
          </Typography>
          <Typography>
            {t("approvalSettings.builtin", "Built-in default")}
          </Typography>
          {snapshot.fallback.requiresProposal ? (
            <>
              <Typography>
                {t("approvalSettings.proposalRequired", "Proposal required")}
                {" · "}
                {t("approvalSettings.count", "Human approvals")}:{" "}
                {snapshot.fallback.requiredApprovals}
              </Typography>
              <Typography>
                {t(
                  "approvalSettings.credit",
                  "Allow eligible user proposer approval",
                )}
                :{" "}
                {snapshot.fallback.allowsProposerApproval
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
      {displayedRules
        .filter(
          (rule) =>
            rule.source === "PROJECT" &&
            rule.conditions.typeKey &&
            !groups.some((entry) => entry.key === rule.conditions.typeKey),
        )
        .map((rule) => (
          <Paper
            key={rule.order}
            variant="outlined"
            sx={{ p: 2 }}
            data-testid="approval-historical-rule"
          >
            <Typography>
              {t("approvalSettings.historical", "Unavailable type")}
            </Typography>
            <ApprovalEffectiveRule rule={rule} />
            {manageApprovalPolicy && (
              <Button
                data-testid="approval-remove-unavailable-rule"
                disabled={busy}
                onClick={() =>
                  draft.update(
                    rules.filter(
                      (_, position) => position !== rule.order - fixed.length,
                    ),
                  )
                }
              >
                {t("approvalSettings.removeUnavailable", "Remove rule")}
              </Button>
            )}
          </Paper>
        ))}
      <Typography variant="body2">
        {t(
          "approvalSettings.permissionHelp",
          "Only governance managers can edit. Agent authorship earns no human approval. Immediate changes retain a proposal audit record.",
        )}
      </Typography>
    </Stack>
  );
}
