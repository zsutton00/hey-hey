import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectApprovalPolicyEffectiveRule } from "../../api";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { useProjectCapabilities } from "../../hooks/auth/useProjectCapabilities";
import { FunctionalDialog } from "../Modals/FunctionalDialog";
import { BuiltInRulesPanel } from "./BuiltInRulesPanel";
import { ProjectRulesPanel } from "./ProjectRulesPanel";
import { ApprovalRuleModal } from "./ApprovalRuleModal";
import { savedProjectRules, withRuleMoved } from "./approvalRuleDocument";
import { entriesFromRule, newRuleEntries } from "./approvalRuleFields";
import {
  useApprovalPolicySave,
  type SaveOutcome,
} from "./useApprovalPolicySave";
import type { RuleTarget } from "./useApprovalRuleForm";

const APPROVAL_TABS = ["project", "builtin"] as const;
type ApprovalTab = (typeof APPROVAL_TABS)[number];

export function ProjectApprovalSettings({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const settings = useApprovalPolicySave(organizationId, projectId);
  const { policy } = settings;
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
  const [tab, setTab] = useQueryState(
    "approvalTab",
    parseAsStringLiteral(APPROVAL_TABS).withDefault("project"),
  );
  const [target, setTarget] = useState<RuleTarget | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [pageFailure, setPageFailure] = useState<SaveOutcome["status"] | null>(
    null,
  );
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
  const rules = snapshot.rules;
  const fixed = rules.filter((rule) => rule.source === "FIXED");
  const defaults = rules.filter((rule) => rule.source === "DEFAULT");
  const projectRules = rules.filter((rule) => rule.source === "PROJECT");
  const savedRules = savedProjectRules(snapshot);
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
  const projectIndex = (rule: ProjectApprovalPolicyEffectiveRule) =>
    rule.order - fixed.length;
  const unavailable = projectRules.filter(
    (rule) =>
      rule.conditions.typeKey &&
      !groups.some((entry) => entry.key === rule.conditions.typeKey),
  );
  const busy = settings.pending;

  const move = async (rule: ProjectApprovalPolicyEffectiveRule, by: number) => {
    const from = projectIndex(rule);
    const outcome = await settings.saveRules((saved) =>
      withRuleMoved(saved, from, from + by),
    );
    setPageFailure(outcome.status === "saved" ? null : outcome.status);
  };
  const restore = async () => {
    setConfirmingRestore(false);
    const outcome = await settings.restoreDefaults();
    setPageFailure(outcome.status === "saved" ? null : outcome.status);
  };
  const reviewLatest = async () => {
    await settings.reviewLatest();
    setPageFailure(null);
  };

  const rowActions = (rule: ProjectApprovalPolicyEffectiveRule) => {
    if (!manageApprovalPolicy || rule.source !== "PROJECT") {
      return undefined;
    }
    const index = projectIndex(rule);
    return (
      <Stack direction="row" gap={1}>
        <Button
          size="small"
          data-testid="approval-rule-move-earlier"
          aria-label={t(
            "approvalSettings.moveEarlier",
            "Move priority earlier",
          )}
          disabled={busy || index === 0}
          onClick={() => void move(rule, -1)}
        >
          {t("approvalSettings.moveEarlierShort", "Earlier")}
        </Button>
        <Button
          size="small"
          data-testid="approval-rule-move-later"
          aria-label={t("approvalSettings.moveLater", "Move priority later")}
          disabled={busy || index === savedRules.length - 1}
          onClick={() => void move(rule, 1)}
        >
          {t("approvalSettings.moveLaterShort", "Later")}
        </Button>
        <Button
          size="small"
          data-testid="approval-rule-edit"
          disabled={busy}
          onClick={() =>
            setTarget({
              typeKey: rule.conditions.typeKey,
              opened: { index, rule: savedRules[index] },
            })
          }
        >
          {t("approvalSettings.edit", "Edit")}
        </Button>
      </Stack>
    );
  };

  const modalTarget = target;
  const modalLabel = !modalTarget
    ? ""
    : (groups.find((entry) => entry.key === (modalTarget.typeKey ?? ""))
        ?.label ??
      modalTarget.typeKey ??
      "");

  return (
    <Stack data-testid="project-approval-settings" gap={2}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        gap={2}
      >
        <Box>
          <Typography variant="h5">
            {t("approvalSettings.title", "Approval rules")}
          </Typography>
          <Typography>
            {t(
              "approvalSettings.intro",
              "Choose when changes apply immediately and when people review them.",
            )}
          </Typography>
        </Box>
        {manageApprovalPolicy && (
          <Button
            data-testid="approval-restore"
            disabled={busy}
            onClick={() => setConfirmingRestore(true)}
          >
            {t("approvalSettings.restore", "Restore defaults")}
          </Button>
        )}
      </Stack>
      <Alert severity="info">
        {t(
          "approvalSettings.orderHelp",
          "Rules are checked in priority order and the first matching rule wins. Priority numbers run across both tabs: fixed built-in rules first, then your project rules, then the remaining built-in rules. Restore defaults replaces your project rules only; built-in rules never change.",
        )}
      </Alert>
      {(policy.error || catalog.error) && (
        <Alert severity="error">
          {t("approvalSettings.refreshError", "Could not refresh settings.")}
          <Button data-testid="approval-retry-refresh" onClick={handleRefresh}>
            {t("approvalSettings.retry", "Try again")}
          </Button>
        </Alert>
      )}
      {pageFailure && (
        <Alert
          severity="error"
          data-testid="approval-save-error"
          action={
            <Button
              color="inherit"
              size="small"
              data-testid="approval-page-review-latest"
              disabled={policy.isFetching}
              onClick={() => void reviewLatest()}
            >
              {t("approvalSettings.reviewLatest", "Review latest settings")}
            </Button>
          }
        >
          {pageFailure === "conflict"
            ? t(
                "approvalSettings.conflict",
                "Someone saved newer settings. Review the latest settings before changing them.",
              )
            : t(
                "approvalSettings.pageSaveError",
                "Could not save the change. Review the latest settings and try again.",
              )}
        </Alert>
      )}
      <Tabs
        value={tab}
        onChange={(_, value: ApprovalTab) => void setTab(value)}
        aria-label={t("approvalSettings.tabs", "Approval rule sections")}
      >
        <Tab
          value="project"
          data-testid="approval-tab-project"
          id="approval-tab-project"
          aria-controls="approval-panel-project"
          label={`${t("approvalSettings.projectRulesTab", "Project rules")} (${projectRules.length})`}
        />
        <Tab
          value="builtin"
          data-testid="approval-tab-builtin"
          id="approval-tab-builtin"
          aria-controls="approval-panel-builtin"
          label={`${t("approvalSettings.builtinRulesTab", "Built-in rules")} (${fixed.length + defaults.length})`}
        />
      </Tabs>
      <Box
        role="tabpanel"
        id={`approval-panel-${tab}`}
        aria-labelledby={`approval-tab-${tab}`}
      >
        {tab === "project" ? (
          <ProjectRulesPanel
            groups={groups}
            group={group}
            onSelectGroup={(key) => void setGroup(key, { history: "push" })}
            projectRules={projectRules}
            unavailable={unavailable}
            canAdd={manageApprovalPolicy}
            busy={busy}
            onAdd={() =>
              setTarget({ typeKey: group || undefined, opened: null })
            }
            rowActions={rowActions}
          />
        ) : (
          <BuiltInRulesPanel
            fixed={fixed}
            defaults={defaults}
            fallback={snapshot.fallback}
          />
        )}
      </Box>
      <Typography variant="body2">
        {t(
          "approvalSettings.permissionHelp",
          "Only governance managers can edit. Agent authorship earns no human approval. Immediate changes retain a proposal audit record.",
        )}
      </Typography>
      {modalTarget && (
        <ApprovalRuleModal
          key={`${modalTarget.opened?.index}:${modalTarget.typeKey}`}
          target={modalTarget}
          groupLabel={modalLabel}
          typeUnavailable={
            modalTarget.typeKey !== undefined &&
            !groups.some((entry) => entry.key === modalTarget.typeKey)
          }
          initial={
            modalTarget.opened
              ? entriesFromRule(
                  modalTarget.opened.rule,
                  fixed.length + modalTarget.opened.index + 1,
                )
              : newRuleEntries(fixed.length + savedRules.length + 1)
          }
          ruleCount={savedRules.length}
          fixedCount={fixed.length}
          save={settings.saveRules}
          pending={busy}
          reviewing={policy.isFetching}
          onReviewLatest={() => void settings.reviewLatest()}
          onClose={() => setTarget(null)}
        />
      )}
      <FunctionalDialog
        open={confirmingRestore}
        onClose={() => setConfirmingRestore(false)}
        aria-labelledby="approval-restore-title"
      >
        <DialogTitle id="approval-restore-title">
          {t("approvalSettings.restoreTitle", "Restore default rules?")}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t(
              "approvalSettings.restoreConfirm",
              "This replaces the project's rules with the standard defaults now. Built-in rules, including fixed approval counts, never change.",
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            data-testid="approval-restore-cancel"
            onClick={() => setConfirmingRestore(false)}
          >
            {t("approvalSettings.cancel", "Cancel")}
          </Button>
          <Button
            variant="contained"
            data-testid="approval-restore-confirm"
            onClick={() => void restore()}
          >
            {t("approvalSettings.restore", "Restore defaults")}
          </Button>
        </DialogActions>
      </FunctionalDialog>
    </Stack>
  );
}
