import { z } from "zod";
import {
  CodingResearchReadinessEvidenceCategoryEnum,
  CodingResearchReportPayloadReportTypeEnum,
  CodingResearchUpdateTypeEnum,
  EntityType,
  type CodingResearchReportPayload,
} from "../../api";

const updateSchema = z.object({
  type: z.nativeEnum(CodingResearchUpdateTypeEnum),
  targets: z.array(
    z.object({
      entityType: z.nativeEnum(EntityType),
      entityId: z.string(),
      title: z.string(),
    }),
  ),
  description: z.string(),
  reason: z.string(),
});

const provenanceSchema = z.object({
  discoveryCalls: z.array(
    z.object({ tool: z.string(), query: z.string(), intent: z.string() }),
  ),
  edgesTraversed: z.array(
    z.object({
      fromId: z.string(),
      toId: z.string(),
      reasoning: z.string(),
    }),
  ),
});

const readinessEvidenceSchema = z.object({
  category: z.nativeEnum(CodingResearchReadinessEvidenceCategoryEnum),
  statement: z.string(),
  sourceRef: z.string().optional(),
});

const codingResearchPayloadSchema = z.object({
  reportType: z.literal(
    CodingResearchReportPayloadReportTypeEnum.CodingResearch,
  ),
  summary: z.string(),
  analysis: z.string(),
  frame: z.record(z.unknown()),
  provenance: provenanceSchema,
  updates: z.array(updateSchema),
  readinessEvidence: z.array(readinessEvidenceSchema).optional(),
});

/** An attempt's summary as the eval runner records it: the target's final text. */
const attemptSummarySchema = z.object({ outputText: z.string().optional() });

/**
 * What an attempt's own record holds of the research it produced. The first
 * batch of attempts kept the research here and nowhere in the target
 * conversation, so absence from the conversation says nothing about it.
 */
export type RetainedResearch =
  | { status: "none" }
  | { status: "readable"; payload: CodingResearchReportPayload }
  | { status: "unreadable"; reason: string };

const unreadable = (reason: string): RetainedResearch => ({
  status: "unreadable",
  reason,
});

export const readRetainedResearch = (summary: unknown): RetainedResearch => {
  // The runner leaves the summary a plain sentence until the target's output
  // is recorded, so a string or nothing at all is "no retained output".
  if (
    summary === undefined ||
    summary === null ||
    typeof summary === "string"
  ) {
    return { status: "none" };
  }
  const recorded = attemptSummarySchema.safeParse(summary);
  if (!recorded.success) {
    return unreadable("The attempt's saved summary has an unexpected shape.");
  }
  const { outputText } = recorded.data;
  if (outputText === undefined || outputText.trim() === "") {
    return { status: "none" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return unreadable("The saved result is not a structured research report.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("reportType" in parsed) ||
    parsed.reportType !==
      CodingResearchReportPayloadReportTypeEnum.CodingResearch
  ) {
    // Other saved text is not structured research; it is not ours to render.
    return unreadable("The saved result is not a structured research report.");
  }
  const research = codingResearchPayloadSchema.safeParse(parsed);
  return research.success
    ? { status: "readable", payload: research.data }
    : unreadable("The saved research report is missing required fields.");
};
