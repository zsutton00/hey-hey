import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type EditorState,
  type LexicalNode,
} from "lexical";
import type { EntityPromptTemplateSyntaxVersion } from "../../api";
import {
  ENTITY_PROMPT_TEMPLATE_LANGUAGES,
  parseEntityPromptTemplate,
} from "../../generated/entity-prompt-template-language";
import { $createTemplateSubstitutionNode } from "./TemplateSubstitutionNode";

export interface TemplateSegment {
  readonly source: string;
  readonly substitution: boolean;
}
export function splitTemplateSource(
  content: string,
  version: EntityPromptTemplateSyntaxVersion,
): TemplateSegment[] {
  const { tokens } = parseEntityPromptTemplate(
    content,
    ENTITY_PROMPT_TEMPLATE_LANGUAGES[version],
  );
  const segments: TemplateSegment[] = [];
  let literalStart = 0;
  for (const token of tokens) {
    if (literalStart < token.start)
      segments.push({
        source: content.slice(literalStart, token.start),
        substitution: false,
      });
    segments.push({
      source: content.slice(token.start, token.end),
      substitution: true,
    });
    literalStart = token.end;
  }
  if (literalStart < content.length)
    segments.push({ source: content.slice(literalStart), substitution: false });
  return segments;
}
export function $templateNodes(
  content: string,
  version: EntityPromptTemplateSyntaxVersion,
): LexicalNode[] {
  return splitTemplateSource(content, version).map((segment) =>
    segment.substitution
      ? $createTemplateSubstitutionNode(segment.source)
      : $createTextNode(segment.source),
  );
}
export function $loadTemplateSource(
  content: string,
  version: EntityPromptTemplateSyntaxVersion,
): void {
  const root = $getRoot();
  root.clear();
  root.append(
    $createParagraphNode().append(...$templateNodes(content, version)),
  );
}
export function serializeTemplateSource(state: EditorState): string {
  return state.read(() => $getRoot().getTextContent());
}
