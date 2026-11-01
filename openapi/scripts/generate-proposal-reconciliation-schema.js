const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const document = yaml.load(
  fs.readFileSync(
    path.join(__dirname, "..", "specs/schemas/proposals.yaml"),
    "utf8",
  ),
);
function resolve(
  value,
  sourceDocument = document,
  baseFile = path.join(__dirname, "..", "specs/schemas/proposals.yaml"),
) {
  if (Array.isArray(value))
    return value.map((entry) => resolve(entry, sourceDocument, baseFile));
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    const [file, pointer] = value.$ref.split("#/");
    const targetFile = file
      ? path.resolve(path.dirname(baseFile), file)
      : baseFile;
    const targetDocument = file
      ? yaml.load(fs.readFileSync(targetFile, "utf8"))
      : sourceDocument;
    const source = pointer
      .split("/")
      .reduce((entry, key) => entry[key], targetDocument);
    if (!source) throw new Error(`Missing schema ${value.$ref}`);
    const { $ref, ...siblings } = value;
    return resolve({ ...source, ...siblings }, targetDocument, targetFile);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      resolve(child, sourceDocument, baseFile),
    ]),
  );
}
const candidate = resolve(document.CreateProposalReconciliationCandidate);
const state = resolve(document.ProposalReconciliationState);
const reviewNote = resolve(document.ProposalReviewNoteDto);
for (const outputPath of process.argv.slice(2)) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "// Generated from OpenAPI by scripts/generate-proposal-reconciliation-schema.js.\n" +
      `export const proposalReconciliationCandidateSchema = ${JSON.stringify(candidate, null, 2)} as const;\n` +
      `export const proposalReconciliationStateSchema = ${JSON.stringify(state, null, 2)} as const;\n` +
      `export const proposalReviewNoteSchema = ${JSON.stringify(reviewNote, null, 2)} as const;\n`,
  );
}
