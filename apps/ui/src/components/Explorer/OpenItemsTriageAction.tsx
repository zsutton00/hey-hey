import { IconButton, Tooltip } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import { useTranslation } from "react-i18next";
import { useModal } from "@hey-hey/ui-common/context";

export function OpenItemsTriageAction({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const modal = useModal();
  return (
    <Tooltip title={t("triage.open", "Triage Open Items")}>
      <IconButton
        size="small"
        data-testid="open-items-triage-action"
        aria-label={t("triage.open", "Triage Open Items")}
        disabled={!modal}
        onClick={(event) => {
          event.stopPropagation();
          modal?.openModal({ type: "triage", organizationId, projectId });
        }}
        sx={{ color: "text.secondary", height: 28, width: 28 }}
      >
        <AutoAwesomeOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
