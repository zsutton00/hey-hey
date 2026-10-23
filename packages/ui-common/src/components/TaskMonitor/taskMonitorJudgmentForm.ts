import {
  ExtendedUIFieldType,
  MessageType,
  SystemMessageDataTypeEnum,
  TaskMonitorJudgmentRequestedSystemMessageDataOutcomeEnum,
  type MessageResponseDto,
  type SystemMessage,
  type SystemMessageData,
  type TaskMonitorJudgmentResolvedCommand,
  type TaskMonitorSupervisionSystemMessageData,
  type UIElement,
} from "../../api";
import type { FormValue } from "../LlmForms/types";

export const TASK_MONITOR_JUDGMENT_FIELD_ID = "task-monitor-judgment-response";

export const resolveTaskMonitorJudgmentTarget = (
  taskMonitorId: string | undefined
): string | null => {
  const normalizedTaskMonitorId = taskMonitorId?.trim();
  return normalizedTaskMonitorId ? normalizedTaskMonitorId : null;
};

const taskMonitorJudgmentField: UIElement = {
  id: TASK_MONITOR_JUDGMENT_FIELD_ID,
  type: ExtendedUIFieldType.Textarea,
  label: "Your judgment",
  placeholder: "Explain your judgment",
  required: true,
  multiline: true,
  influences: [],
};

const isTaskMonitorSupervisionData = (
  data: SystemMessageData
): data is TaskMonitorSupervisionSystemMessageData =>
  data.type === SystemMessageDataTypeEnum.TaskMonitorSupervision &&
  "outcome" in data &&
  data.outcome ===
    TaskMonitorJudgmentRequestedSystemMessageDataOutcomeEnum.JudgmentRequested;

export const isAwaitingTaskMonitorJudgment = (
  message: MessageResponseDto
): message is SystemMessage & {
  data: TaskMonitorSupervisionSystemMessageData;
} =>
  message.type === MessageType.System &&
  message.awaitingResponse &&
  isTaskMonitorSupervisionData(message.data);

export const getTaskMonitorJudgmentFormUiElements = (
  message: MessageResponseDto
): UIElement[] =>
  isAwaitingTaskMonitorJudgment(message) ? [taskMonitorJudgmentField] : [];

const getJudgmentText = (value: FormValue): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text.trim();
  }
  throw new Error("A judgment response is required.");
};

export const buildTaskMonitorJudgmentCommand = (
  requestMessageId: string,
  data: Record<string, FormValue>
): TaskMonitorJudgmentResolvedCommand => {
  const conclusion = getJudgmentText(data[TASK_MONITOR_JUDGMENT_FIELD_ID]);
  if (!conclusion) {
    throw new Error("A judgment response is required.");
  }
  return {
    cause: "JUDGMENT_RESOLVED",
    judgment: {
      requestMessageId,
      label: taskMonitorJudgmentField.label,
      conclusion,
    },
  };
};
