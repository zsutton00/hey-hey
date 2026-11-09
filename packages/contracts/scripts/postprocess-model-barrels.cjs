const fs = require("node:fs");
const path = require("node:path");

const legacyApiEnumExports = [
  'export { CanonicalMetadataBaseTypeEnum as CanonicalTaskMetadataTypeEnum } from "./canonical-metadata-base.js";',
  'export type { CanonicalMetadataBaseTypeEnum as CanonicalTaskMetadataTypeEnum } from "./canonical-metadata-base.js";',
  'export { CliReadChangedFileInventoryEntryAllOfStatusEnum as CliReadChangedFileInventoryEntryStatusEnum } from "./cli-read-changed-file-inventory-entry-all-of.js";',
  'export type { CliReadChangedFileInventoryEntryAllOfStatusEnum as CliReadChangedFileInventoryEntryStatusEnum } from "./cli-read-changed-file-inventory-entry-all-of.js";',
  'export { ReportUsageBreakdownEntryAllOfRoleEnum as ReportUsageBreakdownEntryRoleEnum } from "./report-usage-breakdown-entry-all-of.js";',
  'export type { ReportUsageBreakdownEntryAllOfRoleEnum as ReportUsageBreakdownEntryRoleEnum } from "./report-usage-breakdown-entry-all-of.js";',
  'export { WebSocketConversationUpdatedEventAllOfChangeTypeEnum as WebSocketConversationUpdatedEventChangeTypeEnum } from "./web-socket-conversation-updated-event-all-of.js";',
  'export type { WebSocketConversationUpdatedEventAllOfChangeTypeEnum as WebSocketConversationUpdatedEventChangeTypeEnum } from "./web-socket-conversation-updated-event-all-of.js";',
  'export { StartRunPromptPayloadProviderEnum as ConversationStartRunRequestDtoProviderEnum } from "./start-run-prompt-payload.js";',
  'export type { StartRunPromptPayloadProviderEnum as ConversationStartRunRequestDtoProviderEnum } from "./start-run-prompt-payload.js";',
  'export { StartRunPromptPayloadReasoningEffortEnum as ConversationStartRunRequestDtoReasoningEffortEnum } from "./start-run-prompt-payload.js";',
  'export type { StartRunPromptPayloadReasoningEffortEnum as ConversationStartRunRequestDtoReasoningEffortEnum } from "./start-run-prompt-payload.js";',
  'export { CodingPromptUserMessageAllOfTypeEnum as CodingPromptUserMessageTypeEnum } from "./coding-prompt-user-message-all-of.js";',
  'export type { CodingPromptUserMessageAllOfTypeEnum as CodingPromptUserMessageTypeEnum } from "./coding-prompt-user-message-all-of.js";',
  'export { CodingPromptUserMessageAllOfNextActionEnum as CodingPromptUserMessageNextActionEnum } from "./coding-prompt-user-message-all-of.js";',
  'export type { CodingPromptUserMessageAllOfNextActionEnum as CodingPromptUserMessageNextActionEnum } from "./coding-prompt-user-message-all-of.js";',
  'export { TaskStubUserMessageAllOfNextActionEnum as TaskStubUserMessageNextActionEnum } from "./task-stub-user-message-all-of.js";',
  'export type { TaskStubUserMessageAllOfNextActionEnum as TaskStubUserMessageNextActionEnum } from "./task-stub-user-message-all-of.js";',
  'export { TaskMonitorJudgmentRequestedSystemMessageDataAllOfOutcomeEnum as TaskMonitorJudgmentRequestedSystemMessageDataOutcomeEnum } from "./task-monitor-judgment-requested-system-message-data-all-of.js";',
  'export type { TaskMonitorJudgmentRequestedSystemMessageDataAllOfOutcomeEnum as TaskMonitorJudgmentRequestedSystemMessageDataOutcomeEnum } from "./task-monitor-judgment-requested-system-message-data-all-of.js";',
  'export { UserMessageDataWorkflowDefinedAllOfPromptTypeEnum as UserMessageDataWorkflowDefinedPromptTypeEnum } from "./user-message-data-workflow-defined-all-of.js";',
  'export type { UserMessageDataWorkflowDefinedAllOfPromptTypeEnum as UserMessageDataWorkflowDefinedPromptTypeEnum } from "./user-message-data-workflow-defined-all-of.js";',
];

function postprocessModelBarrels(directory, target) {
  const modelsDirectory = path.join(directory, "models");
  const modelsBarrel = path.join(directory, "models.ts");
  if (!fs.existsSync(path.join(modelsDirectory, "index.ts"))) {
    throw new Error(
      `Generated model barrel is missing from ${modelsDirectory}.`,
    );
  }
  if (!fs.existsSync(modelsBarrel)) {
    fs.writeFileSync(modelsBarrel, 'export * from "./models/index.js";\n');
  }

  const indexFile = path.join(directory, "index.ts");
  const original = fs.readFileSync(indexFile, "utf8");
  const generatedExport = 'export * from "./models.js";';
  const correctedExport = 'export * from "./models/index.js";';

  if (!original.includes(correctedExport)) {
    if (!original.includes(generatedExport)) {
      throw new Error(`Generated model barrel is missing from ${indexFile}.`);
    }

    fs.writeFileSync(
      indexFile,
      original.replace(generatedExport, correctedExport),
    );
  }

  if (target === "api") postprocessApiEnumExports(directory);
}

function postprocessApiEnumExports(directory) {
  const modelsIndex = path.join(directory, "models", "index.ts");
  const original = fs.readFileSync(modelsIndex, "utf8");
  const missingExports = legacyApiEnumExports.filter(
    (line) => !original.includes(line),
  );
  if (missingExports.length === 0) return;

  const expectedFiles = [
    "canonical-metadata-base.ts",
    "cli-read-changed-file-inventory-entry-all-of.ts",
    "report-usage-breakdown-entry-all-of.ts",
    "web-socket-conversation-updated-event-all-of.ts",
    "start-run-prompt-payload.ts",
    "coding-prompt-user-message-all-of.ts",
    "task-stub-user-message-all-of.ts",
    "task-monitor-judgment-requested-system-message-data-all-of.ts",
    "user-message-data-workflow-defined-all-of.ts",
  ];
  for (const file of expectedFiles) {
    if (!fs.existsSync(path.join(directory, "models", file))) {
      throw new Error(`Generated API model is missing: ${file}`);
    }
  }

  fs.writeFileSync(
    modelsIndex,
    `${original.trimEnd()}\n${missingExports.join("\n")}\n`,
  );
}

if (require.main === module) {
  const [generatedRoot, targets] = process.argv.slice(2);
  if (!generatedRoot || !targets) {
    throw new Error(
      "Usage: postprocess-model-barrels.cjs <generated-root> <target,...>",
    );
  }

  for (const target of targets.split(",")) {
    const directory = path.join(generatedRoot, target);
    postprocessModelBarrels(directory, target);
  }
}

module.exports = postprocessModelBarrels;
