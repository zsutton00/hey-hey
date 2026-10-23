import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const WORK_ITEM_GRAPH_LAYOUT_SCHEMA_REF =
  '#/components/schemas/WorkItemGraphLayoutValue';
export const WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION =
  'work-item-graph-layout.v1';
export const WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_REF =
  '#/components/schemas/WorkItemGraphLayoutPreferenceValue';
export const WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION =
  'work-item-graph-layout-preference.v1';

const persistedNodeRefSchema = z
  .object({
    kind: z.literal('persistedWorkItem'),
    workItemId: z.string().uuid(),
  })
  .strict();

const temporaryNodeRefSchema = z
  .object({
    kind: z.literal('temporaryWorkItem'),
    temporaryRef: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/),
  })
  .strict();

const nodeRefSchema = z.union([persistedNodeRefSchema, temporaryNodeRefSchema]);

const logicalPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

const nodePositionSchema = z
  .object({
    node: nodeRefSchema,
    position: logicalPositionSchema,
  })
  .strict();

const layoutSchema = z
  .object({
    schemaVersion: z.literal(WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION),
    nodes: z.array(nodePositionSchema),
  })
  .strict();

const layoutPreferenceSchema = z
  .object({
    schemaVersion: z.literal(WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION),
    rows: z.number().int().positive(),
    columns: z.number().int().positive(),
  })
  .strict();

type ParsedLayout = z.infer<typeof layoutSchema>;

export type WorkItemGraphLayoutValidationResult =
  | {
      success: true;
      value: ParsedLayout;
      canonicalContent: string;
    }
  | {
      success: false;
      message: string;
    };

export function validateWorkItemGraphLayoutContent(
  content: unknown,
): WorkItemGraphLayoutValidationResult {
  const parsedJson =
    typeof content === 'string' ? parseJsonString(content) : { value: content };

  if ('error' in parsedJson) {
    return { success: false, message: parsedJson.error };
  }

  const result = layoutSchema.safeParse(parsedJson.value);
  if (!result.success) {
    return {
      success: false,
      message: result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          return `${path}: ${issue.message}`;
        })
        .join('; '),
    };
  }

  const canonicalValue = canonicalizeLayoutValue(result.data);
  return {
    success: true,
    value: canonicalValue,
    canonicalContent: JSON.stringify(canonicalValue),
  };
}

export function validateWorkItemGraphLayoutPreferenceContent(content: unknown):
  | {
      success: true;
      value: z.infer<typeof layoutPreferenceSchema>;
      canonicalContent: string;
    }
  | { success: false; message: string } {
  const parsedJson =
    typeof content === 'string' ? parseJsonString(content) : { value: content };
  if ('error' in parsedJson)
    return { success: false, message: parsedJson.error };
  const result = layoutPreferenceSchema.safeParse(parsedJson.value);
  if (!result.success) {
    return {
      success: false,
      message: result.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; '),
    };
  }
  return {
    success: true,
    value: result.data,
    canonicalContent: JSON.stringify(result.data),
  };
}

export function canonicalizeWorkItemGraphLayoutContent(
  content: unknown,
): string {
  const result = validateWorkItemGraphLayoutContent(content);
  if (!result.success) {
    throw new BadRequestException(
      `Invalid work item graph layout: ${result.message}`,
    );
  }
  return result.canonicalContent;
}

function canonicalizeLayoutValue(value: ParsedLayout): ParsedLayout {
  return {
    schemaVersion: value.schemaVersion,
    nodes: value.nodes.map((nodePosition) => ({
      node:
        nodePosition.node.kind === 'persistedWorkItem'
          ? {
              kind: nodePosition.node.kind,
              workItemId: nodePosition.node.workItemId,
            }
          : {
              kind: nodePosition.node.kind,
              temporaryRef: nodePosition.node.temporaryRef,
            },
      position: {
        x: nodePosition.position.x,
        y: nodePosition.position.y,
      },
    })),
  };
}

function parseJsonString(
  content: string,
): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(content) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `content is not valid JSON: ${error.message}`
          : 'content is not valid JSON',
    };
  }
}
