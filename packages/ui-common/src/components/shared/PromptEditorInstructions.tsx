import { Typography } from "@mui/material";
import { useCanHover } from "../../hooks/useCanHover";

const MAC_PLATFORM_PREFIX = "Mac";

export const getPromptSubmitShortcut = (platform: string): string =>
  platform.startsWith(MAC_PLATFORM_PREFIX) ? "⌘+Enter" : "Ctrl+Enter";

const getCurrentPlatform = (): string =>
  typeof navigator === "undefined" ? "" : navigator.platform;

export const PromptEditorInstructions = () => {
  const canHover = useCanHover();
  const submitShortcut = getPromptSubmitShortcut(getCurrentPlatform());

  if (!canHover) {
    return null;
  }

  return (
    <Typography
      variant="body2"
      color="text.secondary"
      data-testid="prompt-editor-instructions"
    >
      Use / for commands. Press {submitShortcut} to submit.
    </Typography>
  );
};
