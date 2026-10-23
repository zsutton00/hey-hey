import { z } from "zod";
import { EntityType } from "../../../api";

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
    type: z.nativeEnum(EntityType),
    title: z.string().min(1),
    content: z.string(),
    contentSource: codingResearchContentSourceSchema,
    edges: z.array(codingResearchFrameEdgeSchema),
  })
  .strict();

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
): CodingResearchFrameModel => {
  const result = codingResearchFrameSchema.safeParse(value);

  return result.success
    ? { state: "ready", frame: result.data }
    : { state: "unavailable" };
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
