import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type EditorState,
  type LexicalNode,
} from "lexical";
import type { EntityPromptTemplateSyntaxVersion } from "../../api";
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from "../../generated/entity-prompt-template-language";
import { $createTemplateSubstitutionNode } from "./TemplateSubstitutionNode";

export interface TemplateSegment {
  readonly source: string;
  readonly substitution: boolean;
}
export function splitTemplateSource(
  content: string,
  version: EntityPromptTemplateSyntaxVersion
): TemplateSegment[] {
  const { authoring, supportedPaths, pathFamilies } =
    ENTITY_PROMPT_TEMPLATE_LANGUAGES[version];
  const { openingDelimiter: open, closingDelimiter: close } = authoring;
  const segments: TemplateSegment[] = [];
  let cursor = 0;
  let literalStart = 0;
  while (cursor < content.length) {
    const start = content.indexOf(open, cursor);
    if (start < 0) break;
    const end = content.indexOf(close, start + open.length);
    if (end < 0) break;
    const path = content.slice(start + open.length, end).trim();
    const supported =
      new RegExp(authoring.inputPathPattern, "u").test(path) &&
      (supportedPaths.includes(path) ||
        pathFamilies.some((family) =>
          new RegExp(family.pattern, "u").test(path)
        ));
    cursor = end + close.length;
    if (!supported) continue;
    if (literalStart < start)
      segments.push({
        source: content.slice(literalStart, start),
        substitution: false,
      });
    segments.push({ source: content.slice(start, cursor), substitution: true });
    literalStart = cursor;
  }
  if (literalStart < content.length)
    segments.push({ source: content.slice(literalStart), substitution: false });
  return segments;
}
export function $templateNodes(
  content: string,
  version: EntityPromptTemplateSyntaxVersion
): LexicalNode[] {
  return splitTemplateSource(content, version).map((segment) =>
    segment.substitution
      ? $createTemplateSubstitutionNode(segment.source)
      : $createTextNode(segment.source)
  );
}
export function $loadTemplateSource(
  content: string,
  version: EntityPromptTemplateSyntaxVersion
): void {
  const root = $getRoot();
  root.clear();
  root.append(
    $createParagraphNode().append(...$templateNodes(content, version))
  );
}
export function serializeTemplateSource(state: EditorState): string {
  return state.read(() => $getRoot().getTextContent());
}
