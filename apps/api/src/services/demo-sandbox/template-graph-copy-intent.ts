import { z } from 'zod';
import { RelationshipType } from '../../generated/graphs';
import type {
  GraphRelationship,
  TemplateGraphCopyCommand,
} from '../../generated/graphs';

export interface CopiedWorkItemExpectation {
  id: string;
  typeKey: string;
  parentTaskId: string | null;
}

const relationshipTypes = new Set<string>(Object.values(RelationshipType));

function isRelationshipType(value: string): value is RelationshipType {
  return relationshipTypes.has(value);
}

const graphRelationshipSchema = z.object({
  id: z.string(),
  type: z.string().refine(isRelationshipType),
  category: z.enum(['meta', 'flow']).optional(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  direction: z.enum(['forward', 'backward']).nullable().optional(),
  predicate: z.string().nullable().optional(),
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const graphCopyCommandSchema = z.object({
  id: z.string(),
  snapshot: z.object({
    nodes: z.array(z.object({ id: z.string(), label: z.string() })),
    edges: z.array(graphRelationshipSchema),
  }),
});

const workItemExpectationSchema = z
  .object({
    id: z.string().uuid(),
    typeKey: z.string().min(1),
    parentTaskId: z.string().uuid().nullable(),
  })
  .strict();

const workItemsSchema = z
  .array(workItemExpectationSchema)
  .min(1)
  .superRefine((workItems, context) => {
    const ids = new Set<string>();
    for (const [index, workItem] of workItems.entries()) {
      if (ids.has(workItem.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'Copied work-item IDs must be unique',
        });
      }
      ids.add(workItem.id);
    }
  });

const persistedGraphCopyIntentSchema = z
  .object({
    graphCommand: graphCopyCommandSchema,
    readinessWorkItems: workItemsSchema,
  })
  .strict();

export function createPersistedGraphCopyIntent(
  graphCommand: TemplateGraphCopyCommand,
  readinessWorkItems: CopiedWorkItemExpectation[],
) {
  return persistedGraphCopyIntentSchema.parse({
    graphCommand,
    readinessWorkItems,
  });
}

/** Reads either a new enveloped intent or a command written before the envelope existed. */
export function readGraphCopyCommand(value: unknown): TemplateGraphCopyCommand {
  const persistedIntent = persistedGraphCopyIntentSchema.safeParse(value);
  if (persistedIntent.success) {
    return persistedIntent.data.graphCommand;
  }

  return graphCopyCommandSchema.parse(value);
}

export function readReadinessWorkItems(
  value: unknown,
): CopiedWorkItemExpectation[] {
  return persistedGraphCopyIntentSchema.parse(value).readinessWorkItems;
}
