// Preserve runtime behavior while allowing generated browser types to be consumed
// directly by the CLI's exactOptionalPropertyTypes compilation.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const apiRoot = path.resolve(
  process.argv[2] ?? path.join(__dirname, "../src/api"),
);
const configurationPath = path.join(apiRoot, "configuration.ts");
if (fs.existsSync(configurationPath)) {
  const configuration = fs
    .readFileSync(configurationPath, "utf8")
    .replace(
      /^([ \t]*)this\.(apiKey|username|password|accessToken|basePath|serverIndex|formDataCtor) = param\.\2;/gm,
      (_, indent, name) =>
        `${indent}if ("${name}" in param) this.${name} = param.${name};`,
    );
  fs.writeFileSync(configurationPath, configuration);
}

const generatedFiles = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(file);
    } else if (entry.isFile() && file.endsWith(".ts")) {
      generatedFiles.push(file);
    }
  }
};
visit(apiRoot);
// Zod's reviewed startup-plan parser exposes explicit undefined for optional
// fields. Match that in the generated input types; JSON wire shapes stay intact.
for (const apiPath of generatedFiles) {
  let api = fs.readFileSync(apiPath, "utf8");
  const source = ts.createSourceFile(
    apiPath,
    api,
    ts.ScriptTarget.Latest,
    true,
  );
  const edits = [];
  for (const statement of source.statements) {
    if (
      !ts.isInterfaceDeclaration(statement) ||
      (!statement.name.text.startsWith("CodingPromptStartup") &&
        statement.name.text !== "DesignDocDraftSection")
    )
      continue;
    for (const member of statement.members) {
      if (
        ts.isPropertySignature(member) &&
        member.questionToken &&
        member.type &&
        !member.type.getText(source).includes("undefined")
      ) {
        edits.push({ position: member.type.getStart(source), text: "(" });
        edits.push({ position: member.type.end, text: ") | undefined" });
      }
    }
  }
  for (const edit of edits.sort((a, b) => b.position - a.position)) {
    api = api.slice(0, edit.position) + edit.text + api.slice(edit.position);
  }
  if (edits.length > 0) fs.writeFileSync(apiPath, api);
}
