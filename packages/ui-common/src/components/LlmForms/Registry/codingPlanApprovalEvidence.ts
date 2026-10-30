import type {
  CodingPlanVersionApproval,
  MessageResponseDto,
} from "../../../api";

export type SubmittedCodingPlanApproval = Pick<
  CodingPlanVersionApproval,
  "responseType" | "versionMessageId" | "feedback"
>;

export function isSubmittedCodingPlanApproval(
  value: unknown,
): value is SubmittedCodingPlanApproval {
  return (
    typeof value === "object" &&
    value !== null &&
    "responseType" in value &&
    value.responseType === "coding_plan_version_approval_v1" &&
    "versionMessageId" in value &&
    typeof value.versionMessageId === "string" &&
    (!("feedback" in value) || typeof value.feedback === "string")
  );
}

/** Older approvals are children of the workflow gate, but name the exact plan. */
export function findCodingPlanApproval(
  messages: readonly MessageResponseDto[],
  versionMessageId: string,
): SubmittedCodingPlanApproval | undefined {
  for (const message of messages) {
    if (
      message.type === "USER" &&
      message.data.action === "APPROVED" &&
      isSubmittedCodingPlanApproval(message.data.payload) &&
      message.data.payload.versionMessageId === versionMessageId
    )
      return message.data.payload;
    const nested = findCodingPlanApproval(
      message.responses ?? [],
      versionMessageId,
    );
    if (nested) return nested;
  }
}
