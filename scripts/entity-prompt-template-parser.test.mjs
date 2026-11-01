import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Generated files are prettier-formatted, so compare ignoring whitespace, quote
// style and trailing punctuation.
const normalize = (text) => text.replace(/[\s'",;|()]/g, "");

const root = new URL("..", import.meta.url);
const parser = fs.readFileSync(
  new URL("scripts/entity-prompt-template-parser.ts", root),
  "utf8",
);

test("API, CLI and UI embed the same entity prompt-template parser", () => {
  const generated = [
    "apps/api/src/generated/entity-prompt-template-language.ts",
    "apps/cli/src/shared/api/generated/entity-prompt-template-language.ts",
    "packages/ui-common/src/generated/entity-prompt-template-language.ts",
  ];
  for (const file of generated) {
    const source = fs.readFileSync(new URL(file, root), "utf8");
    assert.ok(
      normalize(source).includes(normalize(parser)),
      `${file} does not embed the shared parser`,
    );
  }
});
