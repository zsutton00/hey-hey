import type { LexicalEditor } from "lexical";

export type ExplicitCommandInteractionOwner =
  | "feature-picker"
  | "slash-command";

const activeOwnersByEditor = new WeakMap<
  LexicalEditor,
  Set<ExplicitCommandInteractionOwner>
>();

export function setExplicitCommandInteractionActive(
  editor: LexicalEditor,
  owner: ExplicitCommandInteractionOwner,
  active: boolean,
): void {
  const activeOwners = activeOwnersByEditor.get(editor) ?? new Set();
  if (active) {
    activeOwners.add(owner);
    activeOwnersByEditor.set(editor, activeOwners);
    return;
  }

  activeOwners.delete(owner);
  if (activeOwners.size === 0) {
    activeOwnersByEditor.delete(editor);
  }
}

export function isExplicitCommandInteractionActive(
  editor: LexicalEditor,
): boolean {
  return (activeOwnersByEditor.get(editor)?.size ?? 0) > 0;
}
