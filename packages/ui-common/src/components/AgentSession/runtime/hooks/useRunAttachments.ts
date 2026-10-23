import type { RunAttachmentTarget } from "./runAttachmentDrop";
import { useFileAttachments } from "./useFileAttachments";

export function useRunAttachments(
  target: RunAttachmentTarget | null,
  conversationId: string | null,
  available: boolean,
) {
  return useFileAttachments(
    target ? { kind: "run", ...target } : null,
    conversationId,
    available,
  );
}
