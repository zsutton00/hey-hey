// Preserve runtime behavior while allowing generated browser types to be consumed
// directly by the CLI's exactOptionalPropertyTypes compilation.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const apiRoot = path.resolve(__dirname, "../src/api");
const configurationPath = path.join(apiRoot, "configuration.ts");
const configuration = fs
  .readFileSync(configurationPath, "utf8")
  .replace(
    /^([ \t]*)this\.(apiKey|username|password|accessToken|basePath|serverIndex|formDataCtor) = param\.\2;/gm,
    (_, indent, name) =>
      `${indent}if ("${name}" in param) this.${name} = param.${name};`,
  );
fs.writeFileSync(configurationPath, configuration);
// Zod's reviewed startup-plan parser exposes explicit undefined for optional
// fields. Match that in the generated input types; JSON wire shapes stay intact.
const apiPath = path.join(apiRoot, "api.ts");
let api = fs.readFileSync(apiPath, "utf8");
const source = ts.createSourceFile(apiPath, api, ts.ScriptTarget.Latest, true);
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
fs.writeFileSync(apiPath, api);
