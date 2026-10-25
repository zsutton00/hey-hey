import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import { useState, type MutableRefObject } from "react";
import type { PromoteGroupToGoalRequest } from "@hey-hey/ui-common/api";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useOpenItems } from "../../contexts/OpenItemsContext";
import { useOpenItemsPromotion } from "../../hooks/useOpenItemsPromotion";
import { useTranslation } from "react-i18next";

/** Shared manual/triage confirmation. Mount with the selected group identity. */
export function OpenItemsPromotionDialog({
  groupId,
  onClose,
  triage,
}: {
  groupId: string;
  onClose: () => void;
  triage?: {
    initialName: string;
    initialDate?: string;
    intent: MutableRefObject<PromoteGroupToGoalRequest | null>;
    onSuccess: () => void;
    onFailure: (error: unknown) => void;
  };
}) {
  const { t } = useTranslation();
  const { groups, items } = useOpenItems();
  const group = groups.find((item) => item.id === groupId);
  const members = items.filter((item) => item.groupId === groupId);
  const canRecover = !!triage?.intent.current;
  const [name, setName] = useState(
    triage?.intent.current?.goalName ??
      triage?.initialName ??
      group?.name ??
      "",
  );
  const [date, setDate] = useState(
    (triage?.intent.current?.targetDate ?? triage?.initialDate)?.slice(0, 10) ??
      "",
  );
  const promotion = useOpenItemsPromotion(
    groupId,
    triage?.onSuccess ?? onClose,
    triage,
  );
  return (
    <Dialog
      open
      onClose={promotion.busy ? undefined : onClose}
      aria-labelledby="open-items-promotion-title"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="open-items-promotion-title">Promote to Goal</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {group && (
            <Typography variant="body2">
              {group.name} · {members.length}{" "}
              {members.length === 1 ? "member" : "members"}
            </Typography>
          )}
          <Typography variant="body2">
            Eligible members will be tracked by a pinned Goal. Other members
            stay open and ungrouped.
          </Typography>
          {!group && (
            <Alert severity="warning">
              {canRecover
                ? t(
                    "triage.recoverMissingGroup",
                    "This group is no longer available. Confirm to recover the earlier promotion attempt.",
                  )
                : "This group is no longer available. Cancel and review Open Items."}
            </Alert>
          )}
          {promotion.error && (
            <Alert severity="error" data-testid="open-items-promotion-error">
              {promotion.error}
            </Alert>
          )}
          <TextField
            autoFocus
            label="Goal name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={
              promotion.busy ||
              promotion.needsRefresh ||
              !!triage?.intent.current
            }
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            label="Target date (optional)"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={
              promotion.busy ||
              promotion.needsRefresh ||
              !!triage?.intent.current
            }
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={promotion.busy}>
          Cancel
        </Button>
        {promotion.needsRefresh && (
          <Button
            onClick={promotion.refreshForReview}
            disabled={promotion.busy}
            data-testid="open-items-promotion-refresh"
          >
            Refresh for review
          </Button>
        )}
        <Button
          variant="contained"
          onClick={() => promotion.confirm(name, date)}
          disabled={
            (!group && !canRecover) ||
            !name.trim() ||
            promotion.busy ||
            promotion.needsRefresh
          }
          data-testid="open-items-promotion-confirm"
        >
          {promotion.busy
            ? "Saving…"
            : canRecover
              ? t("triage.recoverPromotion", "Recover promotion")
              : "Create Goal"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
