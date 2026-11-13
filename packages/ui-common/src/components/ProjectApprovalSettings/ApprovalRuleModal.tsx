import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ProjectApprovalPolicyAction,
  ProjectApprovalPolicyAuthor,
  ProjectApprovalPolicyChangeSelector,
} from "../../api";
import { FunctionalDialog } from "../Modals/FunctionalDialog";
import {
  ANY,
  FEATURE_TYPE_KEY,
  FIELD_INFO,
  type RuleEntries,
  type RuleFieldKey,
} from "./approvalRuleFields";
import { useApprovalRuleForm, type RuleTarget } from "./useApprovalRuleForm";
import type { SaveOutcome } from "./useApprovalPolicySave";
import type { ProjectApprovalPolicyRule } from "../../api";

type Props = {
  target: RuleTarget;
  /** Name of the group the modal was opened from. */
  groupLabel: string;
  typeUnavailable: boolean;
  initial: RuleEntries;
  ruleCount: number;
  fixedCount: number;
  save: (
    change: (
      rules: ProjectApprovalPolicyRule[],
    ) => ProjectApprovalPolicyRule[] | null,
  ) => Promise<SaveOutcome>;
  pending: boolean;
  reviewing: boolean;
  onReviewLatest: () => void;
  onClose: () => void;
};

function FieldLine({
  field,
  label,
  htmlFor,
  badge,
  children,
}: {
  field: RuleFieldKey;
  label: string;
  htmlFor: string;
  badge?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const infoId = useId();
  return (
    <Box
      data-testid={`approval-rule-field-${field}`}
      sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.5 }}>
        <Typography
          component="label"
          htmlFor={htmlFor}
          variant="body2"
          fontWeight={600}
        >
          {label}
        </Typography>
        {badge && (
          <Typography variant="caption" color="text.secondary">
            {badge}
          </Typography>
        )}
        <IconButton
          size="small"
          aria-label={t("approvalSettings.about", "About {{label}}", { label })}
          aria-expanded={open}
          aria-controls={infoId}
          onClick={() => setOpen((value) => !value)}
        >
          <InfoOutlinedIcon fontSize="inherit" />
        </IconButton>
      </Stack>
      {children}
      <Box
        id={infoId}
        role="note"
        hidden={!open}
        sx={{ mt: 1, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}
      >
        <Typography variant="caption">{FIELD_INFO[field]}</Typography>
      </Box>
    </Box>
  );
}

export function ApprovalRuleModal({
  target,
  groupLabel,
  typeUnavailable,
  initial,
  ruleCount,
  fixedCount,
  save,
  pending,
  reviewing,
  onReviewLatest,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const ids = useId();
  const form = useApprovalRuleForm({
    target,
    initial,
    ruleCount,
    fixedCount,
    save,
    onSaved: onClose,
    messages: {
      approvals: t(
        "approvalSettings.approvalsInvalid",
        "Enter a whole number of approvals from 1 up to 2147483647.",
      ),
      immediateApprovals: t(
        "approvalSettings.immediateApprovalsInvalid",
        "Applying immediately needs 0 approvals.",
      ),
      priority: (min, max) =>
        t(
          "approvalSettings.priorityInvalid",
          "Enter a whole number from {{min}} to {{max}}.",
          { min, max },
        ),
    },
  });
  const { entries, errors } = form;
  const isFeature = target.typeKey === FEATURE_TYPE_KEY;
  const idFor = (field: RuleFieldKey) => `${ids}-${field}`;
  const anyLabel = t("approvalSettings.any", "Any");
  const choice = (
    field: "author" | "action" | "change",
    label: string,
    options: Record<string, string>,
  ) => (
    <FieldLine field={field} label={label} htmlFor={idFor(field)}>
      <TextField
        select
        fullWidth
        size="small"
        id={idFor(field)}
        value={entries[field]}
        error={!!errors[field]}
        helperText={errors[field]}
        onChange={(event) => form.change(field, event.target.value)}
        slotProps={{ select: { native: true } }}
      >
        <option value={ANY}>{anyLabel}</option>
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </TextField>
    </FieldLine>
  );
  const title = form.adding
    ? t("approvalSettings.addRuleTitle", "Add rule")
    : t("approvalSettings.editRuleTitle", "Edit rule");
  const titleId = `${ids}-title`;

  return (
    <FunctionalDialog
      open
      fullWidth
      maxWidth="sm"
      onClose={pending ? undefined : onClose}
      aria-labelledby={titleId}
      data-testid="approval-rule-modal"
    >
      <DialogTitle id={titleId}>
        {groupLabel ? `${title} · ${groupLabel}` : title}
      </DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary">
          {t(
            "approvalSettings.modalHelp",
            "Rules are checked in priority order and the first match applies.",
          )}
        </Typography>
        {target.typeKey !== undefined && (
          <Box
            data-testid="approval-rule-field-type"
            sx={{ py: 1.5, borderTop: 1, borderColor: "divider", mt: 1 }}
          >
            <Typography variant="body2" fontWeight={600}>
              {t("approvalSettings.type", "Type")}
            </Typography>
            <Typography variant="body2" data-testid="approval-rule-type">
              {groupLabel}
              {typeUnavailable &&
                ` · ${t("approvalSettings.historical", "Unavailable type")}`}
            </Typography>
          </Box>
        )}
        {choice("author", t("approvalSettings.author", "Author"), {
          [ProjectApprovalPolicyAuthor.Agent]: t(
            "approvalSettings.agent",
            "Agent",
          ),
          [ProjectApprovalPolicyAuthor.User]: t(
            "approvalSettings.user",
            "User",
          ),
        })}
        {choice("action", t("approvalSettings.action", "Action"), {
          [ProjectApprovalPolicyAction.Create]: t(
            "approvalSettings.createAction",
            "Create",
          ),
          [ProjectApprovalPolicyAction.Update]: t(
            "approvalSettings.updateAction",
            "Update",
          ),
          [ProjectApprovalPolicyAction.Delete]: t(
            "approvalSettings.deleteAction",
            "Delete",
          ),
        })}
        {choice("change", t("approvalSettings.change", "Changes"), {
          [ProjectApprovalPolicyChangeSelector.StatusOnly]: t(
            "approvalSettings.statusOnly",
            "Status only",
          ),
          [ProjectApprovalPolicyChangeSelector.ContentChange]: t(
            "approvalSettings.contentChange",
            "Content changes",
          ),
        })}
        {isFeature && (
          <FieldLine
            field="topLevel"
            label={t("approvalSettings.topLevelField", "Top-level")}
            htmlFor={idFor("topLevel")}
            badge={t("approvalSettings.featureOnly", "Feature only")}
          >
            <TextField
              select
              fullWidth
              size="small"
              id={idFor("topLevel")}
              value={entries.topLevel}
              error={!!errors.topLevel}
              helperText={errors.topLevel}
              onChange={(event) => {
                const value = event.target.value;
                if (
                  value === ANY ||
                  value === "TOP_LEVEL" ||
                  value === "NOT_TOP_LEVEL"
                ) {
                  form.change("topLevel", value);
                }
              }}
              slotProps={{ select: { native: true } }}
            >
              <option value={ANY}>{anyLabel}</option>
              <option value="TOP_LEVEL">
                {t("approvalSettings.topLevelOnly", "Top-level only")}
              </option>
              <option value="NOT_TOP_LEVEL">
                {t("approvalSettings.notTopLevel", "Not top-level")}
              </option>
            </TextField>
          </FieldLine>
        )}
        <FieldLine
          field="outcome"
          label={t("approvalSettings.outcome", "Outcome")}
          htmlFor={idFor("outcome")}
        >
          <TextField
            select
            fullWidth
            size="small"
            id={idFor("outcome")}
            value={entries.outcome}
            error={!!errors.outcome}
            helperText={errors.outcome}
            onChange={(event) => {
              const immediate = event.target.value === "IMMEDIATE";
              form.change(
                "outcome",
                immediate ? "IMMEDIATE" : "PROJECT_REQUIRED",
              );
              form.change(
                "approvals",
                immediate
                  ? "0"
                  : entries.approvals === "0"
                    ? "1"
                    : entries.approvals,
              );
            }}
            slotProps={{ select: { native: true } }}
          >
            <option value="PROJECT_REQUIRED">
              {t("approvalSettings.review", "Require human approval")}
            </option>
            <option value="IMMEDIATE">
              {t("approvalSettings.immediate", "Apply immediately")}
            </option>
          </TextField>
        </FieldLine>
        <FieldLine
          field="approvals"
          label={t("approvalSettings.count", "Human approvals")}
          htmlFor={idFor("approvals")}
        >
          <TextField
            fullWidth
            size="small"
            id={idFor("approvals")}
            value={entries.approvals}
            error={!!errors.approvals}
            helperText={errors.approvals}
            onChange={(event) => form.change("approvals", event.target.value)}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
          />
        </FieldLine>
        <FieldLine
          field="credit"
          label={t(
            "approvalSettings.credit",
            "Allow eligible user proposer approval",
          )}
          htmlFor={idFor("credit")}
        >
          <FormControlLabel
            label={
              entries.credit
                ? t("approvalSettings.yes", "Yes")
                : t("approvalSettings.no", "No")
            }
            control={
              <Checkbox
                id={idFor("credit")}
                checked={entries.credit}
                onChange={(_, checked) => form.change("credit", checked)}
              />
            }
          />
        </FieldLine>
        <FieldLine
          field="priority"
          label={t("approvalSettings.priority", "Global priority")}
          htmlFor={idFor("priority")}
        >
          <TextField
            fullWidth
            size="small"
            id={idFor("priority")}
            value={entries.priority}
            error={!!errors.priority}
            helperText={errors.priority}
            onChange={(event) => form.change("priority", event.target.value)}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
          />
        </FieldLine>
        {form.failure && (
          <Alert
            severity="error"
            role="alert"
            data-testid="approval-rule-save-error"
            sx={{ mt: 1 }}
            action={
              form.failure === "conflict" || form.failure === "failed" ? (
                <Button
                  color="inherit"
                  size="small"
                  data-testid="approval-review-latest"
                  disabled={reviewing}
                  onClick={onReviewLatest}
                >
                  {t("approvalSettings.reviewLatest", "Review latest settings")}
                </Button>
              ) : undefined
            }
          >
            {form.failure === "missing"
              ? t(
                  "approvalSettings.missingRule",
                  "This rule was removed or changed in the latest settings, so nothing was saved. Your entries are kept.",
                )
              : t(
                  "approvalSettings.saveFailed",
                  "Couldn’t save this rule. Your entries are kept. If someone saved a newer revision, review the latest settings before saving again.",
                )}
          </Alert>
        )}
        {form.confirmingDelete && (
          <Alert
            severity="warning"
            sx={{ mt: 1 }}
            data-testid="approval-rule-delete-confirm"
            action={
              <>
                <Button
                  color="inherit"
                  size="small"
                  data-testid="approval-rule-delete-cancel"
                  onClick={() => form.setConfirmingDelete(false)}
                >
                  {t("approvalSettings.keepRule", "Keep rule")}
                </Button>
                <Button
                  color="error"
                  size="small"
                  data-testid="approval-rule-delete-confirm-button"
                  disabled={pending}
                  onClick={() => void form.remove()}
                >
                  {t("approvalSettings.confirmDelete", "Delete this rule")}
                </Button>
              </>
            }
          >
            {t(
              "approvalSettings.confirmDeletePrompt",
              "Delete this rule from the project now?",
            )}
          </Alert>
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1 }}
        >
          {t(
            "approvalSettings.modalFooter",
            "Saving applies this rule to the project now. Source: Project configuration. Fixed approval counts still apply and cannot be overridden here.",
          )}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Box>
          {!form.adding && (
            <Button
              color="error"
              data-testid="approval-rule-delete"
              disabled={pending}
              onClick={() => form.setConfirmingDelete(true)}
            >
              {t("approvalSettings.delete", "Delete rule")}
            </Button>
          )}
        </Box>
        <Stack direction="row" gap={1}>
          <Button
            data-testid="approval-rule-cancel"
            disabled={pending}
            onClick={onClose}
          >
            {t("approvalSettings.cancel", "Cancel")}
          </Button>
          <Button
            variant="contained"
            data-testid="approval-rule-submit"
            disabled={pending}
            onClick={() => void form.submit()}
          >
            {form.adding
              ? t("approvalSettings.addRuleSubmit", "Add rule")
              : t("approvalSettings.updateRuleSubmit", "Update rule")}
          </Button>
        </Stack>
      </DialogActions>
    </FunctionalDialog>
  );
}
