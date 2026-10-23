import { z } from 'zod';

export const WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_REF =
  '#/components/schemas/WorkItemGraphNodePresentationValue';
export const WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION =
  'work-item-graph-node-presentation.v1' as const;

const workItemGraphNodePresentationSchema = z
  .object({
    schemaVersion: z.literal(WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .strict();

export type WorkItemGraphNodePresentationValue = z.infer<
  typeof workItemGraphNodePresentationSchema
>;

export type WorkItemGraphNodePresentationValidationResult =
  | { success: true; canonicalContent: string }
  | { success: false; message: string };

export function validateWorkItemGraphNodePresentationContent(
  content: unknown,
): WorkItemGraphNodePresentationValidationResult {
  let value = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      return {
        success: false,
        message: 'Graph node presentation must contain valid JSON.',
      };
    }
  }

  const parsed = workItemGraphNodePresentationSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      message:
        'Graph node presentation must contain schemaVersion ' +
        `'${WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION}'` +
        ' and an optional six-digit hexadecimal color.',
    };
  }

  return {
    success: true,
    canonicalContent: JSON.stringify(parsed.data),
  };
}
