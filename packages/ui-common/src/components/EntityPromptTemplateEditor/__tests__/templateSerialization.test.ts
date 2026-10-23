import { createEditor, $getRoot } from "lexical";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  $loadTemplateSource,
  serializeTemplateSource,
  splitTemplateSource,
} from "../templateSerialization";
import { TemplateSubstitutionNode } from "../TemplateSubstitutionNode";
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from "../../../generated/entity-prompt-template-language";

describe("template source fidelity", () => {
  it.each([
    "",
    "\t  \r\n\nend\r\n",
    "{{ entity.name }}{{entity.id}}",
    "{{entity.sections.custom_key}}\t{{context.content.sections.details}}",
    "{{unknown}} {{}} {{entity.name",
    "{{context.relatedEntities}}\r\n{{context.agentSessions}}",
  ])("round trips %j without normalizing source", (content) => {
    const editor = createEditor({
      namespace: "test",
      nodes: [TemplateSubstitutionNode],
      onError: (error) => {
        throw error;
      },
    });
    editor.update(() => $loadTemplateSource(content, "V1"), { discrete: true });
    expect(serializeTemplateSource(editor.getEditorState())).toBe(content);
    editor
      .getEditorState()
      .read(() => expect($getRoot().getChildrenSize()).toBe(1));
    expect(
      splitTemplateSource(content, "V1")
        .map((part) => part.source)
        .join("")
    ).toBe(content);
  });
  it("recognizes concrete families while preserving unsupported and malformed expressions as text", () => {
    const parts = splitTemplateSource(
      "{{entity.sections.custom_key}} {{entity.sections.<key>}} {{entity.{name}}}",
      "V1"
    );
    expect(
      parts.filter((part) => part.substitution).map((part) => part.source)
    ).toEqual(["{{entity.sections.custom_key}}"]);
  });
  it("describes all identifiers and deterministically regenerates the catalog", () => {
    const language = ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1;
    expect(language.authoring.paths.map((entry) => entry.path)).toEqual(
      language.supportedPaths
    );
    expect(
      language.authoring.paths.every((entry) => entry.description.length > 0)
    ).toBe(true);
    const file = "src/generated/entity-prompt-template-language.ts";
    const before = readFileSync(file, "utf8");
    execFileSync(process.execPath, [
      "scripts/generate-entity-prompt-template-language.cjs",
    ]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
