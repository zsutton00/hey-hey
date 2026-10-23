import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Button, Typography } from "@mui/material";
import HelpIcon from "@mui/icons-material/Help";

import { useTranslation } from "react-i18next";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";
import type { FieldComponentProps } from "./types";
import {
  useOptionalWalkthroughContext,
  WalkthroughType,
} from "../../../contexts/WalkthroughContext";
import type { WorkItem } from "../../../services";

export interface TaskFeedbackFieldProps
  extends Omit<FieldComponentProps, "onChange"> {
  value: WorkItem;
  onChange: (value: string) => void;
}

export const TaskFeedbackField: React.FC<TaskFeedbackFieldProps> = ({
  value: _initiative,
  onChange,
  context,
  disabled,
  isSubmitted,
}) => {
  const { t } = useTranslation();
  const walkthroughContext = useOptionalWalkthroughContext();
  const triggerWalkthrough = walkthroughContext?.triggerWalkthrough;

  // Reply text state
  const [replyText, setReplyText] = useState("");
  const [hasUnsavedReply, setHasUnsavedReply] = useState(false);

  // Track unsaved reply changes
  useEffect(() => {
    setHasUnsavedReply(replyText.trim().length > 0);
  }, [replyText]);

  // Refs for tooltip anchors
  const processTitleRef = useRef<HTMLDivElement>(null);

  const handleReplyChange = useCallback(
    (value: string) => {
      setReplyText(value);

      // Notify parent component (DynamicForm) when reply text changes
      // This enables the Next button when content is entered
      if (onChange) {
        onChange(value);
      }
    },
    [onChange]
  );

  const handleShowInstructions = useCallback(() => {
    triggerWalkthrough?.(WalkthroughType.INITIATIVE_EDITOR);
  }, [triggerWalkthrough]);

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: 500, mb: 1 }}
          ref={processTitleRef}
        >
          {t("terms.initiative", "Initiative")}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Button
            startIcon={<HelpIcon />}
            onClick={handleShowInstructions}
            variant="text"
            size="small"
            disabled={disabled}
            sx={{
              color: "rgb(60, 114, 160)",
              "&:hover": {
                backgroundColor: "rgba(60, 114, 160, 0.1)",
              },
            }}
          >
            {t("initiative.intro.showInstructions", "Show Instructions")}
          </Button>
        </Box>

        <SmartTextAreaCard
          value={replyText}
          onChange={handleReplyChange}
          mentionConversationId={context.conversationId}
          headerText={t("initiative.intro.getStarted", "Let's get started")}
          placeholder={t(
            "initiative.intro.replyPlaceholder",
            "Share your thoughts, questions, or feedback about this {{term}}...",
            { term: t("terms.initiative", "initiative").toLowerCase() }
          )}
          saveStatus={"complete"}
          saveMode={null}
          hasUnsavedChanges={hasUnsavedReply}
          isSaving={false}
          minRows={2}
          maxRows={40}
          disabled={isSubmitted || disabled}
        />
      </Box>
    </Box>
  );
};
