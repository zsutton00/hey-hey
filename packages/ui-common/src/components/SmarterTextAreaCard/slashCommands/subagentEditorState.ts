import { $getRoot, $isParagraphNode } from "lexical";
import { serializeEditorState } from "../serializationUtils";
import { $isSubagentCommandNode } from "./SubagentCommandNode";
import {
  startsWithSubagentCommand,
  type SubagentCommandChoices,
  type SubagentCommandIntent,
} from "./subagentCommand";

export type SubagentEditorState =
  | { kind: "literal" }
  | { kind: "unconverted" }
  | { kind: "empty"; choices: SubagentCommandChoices }
  | { kind: "ready"; intent: SubagentCommandIntent };

/** Must be read inside the editor state that owns the draft. */
export function $readSubagentEditorState(): SubagentEditorState {
  const paragraph = $getRoot().getFirstChild();
  const first = $isParagraphNode(paragraph) ? paragraph.getFirstChild() : null;
  if (!$isSubagentCommandNode(first)) {
    return startsWithSubagentCommand(serializeEditorState())
      ? { kind: "unconverted" }
      : { kind: "literal" };
  }
  const choices = first.getChoices();
  const objective = serializeEditorState(first.getKey()).trim();
  return objective
    ? { kind: "ready", intent: { kind: "subagent", ...choices, objective } }
    : { kind: "empty", choices };
}
