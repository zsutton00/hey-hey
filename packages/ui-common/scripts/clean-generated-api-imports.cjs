#!/usr/bin/env node

const fs = require("node:fs");
const ts = require("typescript");

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: clean-generated-api-imports.cjs <typescript-file>");
  process.exit(1);
}

const source = fs.readFileSync(filePath, "utf8");
const sourceFile = ts.createSourceFile(
  filePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const usedIdentifiers = new Set();

function collectUsedIdentifiers(node) {
  if (ts.isImportDeclaration(node)) {
    return;
  }

  if (ts.isIdentifier(node)) {
    usedIdentifiers.add(node.text);
  }

  ts.forEachChild(node, collectUsedIdentifiers);
}

collectUsedIdentifiers(sourceFile);

const edits = [];

function visitImports(node) {
  if (ts.isImportDeclaration(node)) {
    const namedBindings = node.importClause?.namedBindings;

    if (namedBindings && ts.isNamedImports(namedBindings)) {
      const retainedSpecifiers = namedBindings.elements.filter((specifier) =>
        usedIdentifiers.has(specifier.name.text)
      );

      if (retainedSpecifiers.length !== namedBindings.elements.length) {
        const originalBindings = source.slice(
          namedBindings.getStart(sourceFile),
          namedBindings.getEnd()
        );
        const isMultiline = originalBindings.includes("\n");
        const replacement = isMultiline
          ? `{
  ${retainedSpecifiers.map((specifier) => specifier.getText(sourceFile)).join(",\n  ")},
}`
          : `{ ${retainedSpecifiers
              .map((specifier) => specifier.getText(sourceFile))
              .join(", ")} }`;

        edits.push({
          start: namedBindings.getStart(sourceFile),
          end: namedBindings.getEnd(),
          replacement,
        });
      }
    }
  }

  ts.forEachChild(node, visitImports);
}

visitImports(sourceFile);

if (edits.length === 0) {
  process.exit(0);
}

const cleanedSource = edits
  .sort((left, right) => right.start - left.start)
  .reduce(
    (currentSource, edit) =>
      `${currentSource.slice(0, edit.start)}${edit.replacement}${currentSource.slice(edit.end)}`,
    source
  );

fs.writeFileSync(filePath, cleanedSource, "utf8");
