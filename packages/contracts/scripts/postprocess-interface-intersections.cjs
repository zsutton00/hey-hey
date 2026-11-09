#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const listTypeScriptFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
};

const collectNamespaceNames = (sourceFile) => {
  const names = new Set();
  const visit = (node) => {
    if (ts.isModuleDeclaration(node)) {
      names.add(node.name.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
};

const rewriteInterface = (source, sourceFile, declaration, baseTypes) => {
  const modifiers = declaration.modifiers
    ?.map((modifier) => modifier.getText(sourceFile))
    .join(" ");
  const typeParameters = declaration.typeParameters?.length
    ? `<${declaration.typeParameters
        .map((parameter) => parameter.getText(sourceFile))
        .join(", ")}>`
    : "";
  const members = source
    .slice(declaration.members.pos, declaration.members.end)
    .trim();
  const intersection = members ? ` & {\n${members}\n}` : "";

  return `${modifiers ? `${modifiers} ` : ""}type ${declaration.name.getText(sourceFile)}${typeParameters} = ${baseTypes.join(" & ")}${intersection};`;
};

const postprocessModelDirectory = (modelsDirectory) => {
  const files = listTypeScriptFiles(modelsDirectory);
  const parsedFiles = files.map((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    return {
      filePath,
      source,
      sourceFile,
      namespaceNames: collectNamespaceNames(sourceFile),
    };
  });
  const namespaceNames = new Set(
    parsedFiles.flatMap(({ namespaceNames: names }) => [...names]),
  );
  let rewrittenCount = 0;

  for (const { filePath, source, sourceFile } of parsedFiles) {
    const replacements = [];
    for (const statement of sourceFile.statements) {
      if (!ts.isInterfaceDeclaration(statement)) continue;
      const extendsClause = statement.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
      );
      if (
        (extendsClause?.types.length ?? 0) < 2 ||
        namespaceNames.has(statement.name.text)
      ) {
        continue;
      }

      replacements.push({
        start: statement.getStart(sourceFile),
        end: statement.end,
        text: rewriteInterface(
          source,
          sourceFile,
          statement,
          extendsClause.types.map((base) => base.getText(sourceFile)),
        ),
      });
    }

    if (replacements.length === 0) continue;

    let updated = source;
    for (const replacement of replacements.sort(
      (left, right) => right.start - left.start,
    )) {
      updated =
        updated.slice(0, replacement.start) +
        replacement.text +
        updated.slice(replacement.end);
    }
    fs.writeFileSync(filePath, updated);
    rewrittenCount += replacements.length;
  }

  return rewrittenCount;
};

if (require.main === module) {
  const [generatedRoot, targets] = process.argv.slice(2);
  if (!generatedRoot || !targets) {
    throw new Error(
      "Usage: postprocess-interface-intersections.cjs <generated-root> <target,...>",
    );
  }

  let totalRewritten = 0;
  for (const target of targets.split(",")) {
    totalRewritten += postprocessModelDirectory(
      path.join(generatedRoot, target, "models"),
    );
  }
  process.stdout.write(
    `Rewrote ${totalRewritten} multi-parent models as intersections.\n`,
  );
}

module.exports = postprocessModelDirectory;
