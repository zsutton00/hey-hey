import type { RunAttachmentReference } from "../../../../api";
import {
  attachmentReferences,
  type RunAttachmentEntry,
} from "../hooks/runAttachmentDrop";

interface InitialPromptSubmissionInput {
  prompt: string;
  machineId: string | null;
  entries: readonly RunAttachmentEntry[];
  handlerDriven: boolean;
}
export function prepareInitialPromptSubmission(
  input: InitialPromptSubmissionInput,
):
  | { ok: false; error: string }
  | {
      ok: true;
      prompt: string;
      machineId: string;
      attachments: RunAttachmentReference[];
    } {
  if (!input.machineId)
    return {
      ok: false,
      error: "Select a destination machine before submitting.",
    };
  if (input.entries.length && !input.handlerDriven)
    return {
      ok: false,
      error:
        "File attachments are unavailable for workflow methods. Remove the files before submitting.",
    };
  if (input.entries.some((entry) => entry.status !== "ready"))
    return {
      ok: false,
      error:
        "Wait for uploads to finish and remove failed files before submitting.",
    };
  return {
    ok: true,
    prompt: input.prompt,
    machineId: input.machineId,
    attachments: attachmentReferences(input.entries),
  };
}
