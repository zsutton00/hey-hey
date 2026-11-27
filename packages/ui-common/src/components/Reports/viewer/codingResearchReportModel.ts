import { z } from "zod";
import { EntityType } from "../../../api";
import { log } from "../../../utils/logger";
import { normalizeEntityType } from "../../entityTypeUtils";

const codingResearchContentSourceSchema = z.enum([
  "original",
  "extracted",
  "summarized",
]);

const codingResearchFrameEdgeSchema = z
  .object({
    toId: z.string().min(1),
    reasoning: z.string(),
    type: z.enum([
      "parent",
      "depends_on",
      "related_to",
      "derives_from",
      "supersedes",
      "contradicts",
    ]),
  })
  .strict();

const codingResearchFrameNodeSchema = z
  .object({
    id: z.string().min(1),
    /** The label the agent reported, which may be any work-item type key. */
    type: z.string().min(1),
    title: z.string().min(1),
    content: z.string(),
    contentSource: codingResearchContentSourceSchema,
    edges: z.array(codingResearchFrameEdgeSchema),
  })
  .strict()
  .transform((node) => ({
    ...node,
    // Contract, Mockup, Feature and project-defined labels are all work items.
    entityType: normalizeEntityType(node.type) ?? EntityType.Task,
  }));

const codingResearchFrameSchema = z
  .object({
    focalId: z.string().min(1),
    nodes: z.array(codingResearchFrameNodeSchema),
  })
  .strict();

type CodingResearchFrame = z.infer<typeof codingResearchFrameSchema>;
export type CodingResearchFrameNode = z.infer<
  typeof codingResearchFrameNodeSchema
>;
export type CodingResearchFrameEdge = z.infer<
  typeof codingResearchFrameEdgeSchema
>;

export type CodingResearchFrameModel =
  { state: "ready"; frame: CodingResearchFrame } | { state: "unavailable" };

export const createCodingResearchFrameModel = (
  value: unknown,
  reportId: string | undefined,
): CodingResearchFrameModel => {
  const result = codingResearchFrameSchema.safeParse(value);

  if (!result.success) {
    // Paths and codes only: the frame holds project content.
    const reason = result.error.issues
      .map((issue) => `${issue.path.join(".") || "frame"}: ${issue.code}`)
      .join("; ");
    log.warn("ui", "Coding research frame could not be read", {
      reportId,
      reason,
    });
    return { state: "unavailable" };
  }

  return { state: "ready", frame: result.data };
};

export const getCodingResearchFocalNode = (
  frameModel: CodingResearchFrameModel,
): CodingResearchFrameNode | null => {
  if (frameModel.state !== "ready") {
    return null;
  }

  return (
    frameModel.frame.nodes.find(
      (node) => node.id === frameModel.frame.focalId,
    ) ?? null
  );
};
