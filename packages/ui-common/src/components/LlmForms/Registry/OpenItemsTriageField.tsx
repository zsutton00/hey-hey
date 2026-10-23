import { Alert } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { OpenItemsTriagePayload, UIElementPayload } from "../../../api";
import { useConversationContext } from "../../Conversation/Components/ConversationContext";
import type { FieldComponentProps } from "./types";
import { OpenItemsTriageSuggestions } from "./OpenItemsTriageSuggestions";

const isTriage = (
  payload: UIElementPayload | undefined
): payload is OpenItemsTriagePayload =>
  !!payload &&
  typeof payload === "object" &&
  "summary" in payload &&
  "suggestions" in payload;
export function OpenItemsTriageField({
  config,
  context,
  disabled,
}: FieldComponentProps) {
  const { t } = useTranslation();
  const { triageApplication, triageItemHref, isReadOnly } =
    useConversationContext();
  if (!isTriage(config.payload) || !triageItemHref)
    return (
      <Alert severity="error">
        {t("triage.unavailable", "Suggestions are unavailable.")}
      </Alert>
    );
  return (
    <OpenItemsTriageSuggestions
      payload={config.payload}
      scope={`${context.conversationId}:${context.messageId}:${config.field}`}
      triageApplication={triageApplication}
      triageItemHref={triageItemHref}
      disabled={!!disabled || isReadOnly}
    />
  );
}
