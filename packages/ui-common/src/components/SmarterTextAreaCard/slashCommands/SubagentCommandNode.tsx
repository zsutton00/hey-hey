import {
  $applyNodeReplacement,
  DecoratorNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import type { ReactNode } from "react";
import type { SubagentCommandChoices } from "./subagentCommand";
import { SubagentCommandControl } from "./SubagentCommandControl";

const copyChoices = (
  choices: SubagentCommandChoices
): SubagentCommandChoices => ({
  ...choices,
  ...(choices.serviceIds ? { serviceIds: [...choices.serviceIds] } : {}),
});

export interface SerializedSubagentCommandNode extends SerializedLexicalNode {
  choices: SubagentCommandChoices;
}

export class SubagentCommandNode extends DecoratorNode<ReactNode> {
  __choices: SubagentCommandChoices;
  constructor(choices: SubagentCommandChoices, key?: NodeKey) {
    super(key);
    this.__choices = copyChoices(choices);
  }
  static getType(): string {
    return "subagent-command";
  }
  static clone(node: SubagentCommandNode): SubagentCommandNode {
    return new SubagentCommandNode(node.__choices, node.__key);
  }
  static importJSON(value: SerializedSubagentCommandNode): SubagentCommandNode {
    if (
      (value.choices.mode !== "foreground" &&
        value.choices.mode !== "background") ||
      value.choices.capability !== "research" ||
      (value.choices.serviceIds !== undefined &&
        (!Array.isArray(value.choices.serviceIds) ||
          value.choices.serviceIds.some((id) => typeof id !== "string")))
    ) {
      throw new Error("Invalid subagent command choices.");
    }
    return $createSubagentCommandNode(value.choices);
  }
  exportJSON(): SerializedSubagentCommandNode {
    return {
      ...super.exportJSON(),
      type: "subagent-command",
      version: 1,
      choices: this.getChoices(),
    };
  }
  getChoices(): SubagentCommandChoices {
    return copyChoices(this.getLatest().__choices);
  }
  setChoices(choices: SubagentCommandChoices): void {
    this.getWritable().__choices = copyChoices(choices);
  }
  // Text is used only at draft storage/clipboard boundaries, never for submission.
  getTextContent(): string {
    const { mode, capability } = this.getChoices();
    return `/subagent ${mode} ${capability} `;
  }
  isInline(): boolean {
    return true;
  }
  createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.contentEditable = "false";
    return element;
  }
  updateDOM(): false {
    return false;
  }
  decorate(): ReactNode {
    return (
      <SubagentCommandControl
        nodeKey={this.getKey()}
        choices={this.getChoices()}
      />
    );
  }
}
export function $createSubagentCommandNode(
  choices: SubagentCommandChoices
): SubagentCommandNode {
  return $applyNodeReplacement(new SubagentCommandNode(choices));
}
export function $isSubagentCommandNode(
  node: unknown
): node is SubagentCommandNode {
  return node instanceof SubagentCommandNode;
}
