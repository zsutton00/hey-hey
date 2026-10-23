import { z } from 'zod';
import { WorkItemStructuredMockupTextProps } from '../../generated/model/workItemStructuredMockupTextProps';
import { WorkItemStructuredMockupContainerProps } from '../../generated/model/workItemStructuredMockupContainerProps';
import type { WorkItemStructuredMockupCaretDirection } from '../../generated/model/workItemStructuredMockupCaretDirection';
import type { WorkItemStructuredMockupColor } from '../../generated/model/workItemStructuredMockupColor';
import type { WorkItemStructuredMockupDividerOrientation } from '../../generated/model/workItemStructuredMockupDividerOrientation';
import type { WorkItemStructuredMockupIconKey } from '../../generated/model/workItemStructuredMockupIconKey';
import type { WorkItemStructuredMockupOverflow } from '../../generated/model/workItemStructuredMockupOverflow';
import type { WorkItemStructuredMockupSemanticRole } from '../../generated/model/workItemStructuredMockupSemanticRole';
import type { WorkItemStructuredMockupShapeKind } from '../../generated/model/workItemStructuredMockupShapeKind';

export const WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3 =
  'work-item-structured-mockup.v3' as const;
export const WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V4 =
  'work-item-structured-mockup.v4' as const;
export const WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V5 =
  'work-item-structured-mockup.v5' as const;

const dimensionSchema = <T extends readonly [string, ...string[]]>(
  modes: T,
  fixedMode: T[number],
) =>
  z
    .object({
      mode: z.enum(modes),
      value: z.number().int().positive().optional(),
    })
    .strict()
    .superRefine((dimension, ctx) => {
      if (
        (dimension.mode === fixedMode && dimension.value === undefined) ||
        (dimension.mode !== fixedMode && dimension.value !== undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: `value is required only when mode is '${String(fixedMode)}'`,
        });
      }
    });

const widthSchema = dimensionSchema(['fit', 'fill', 'fixed'], 'fixed');
const heightSchema = dimensionSchema(['content', 'fixed'], 'fixed');
const layoutProps = {
  id: z.string().min(1),
  width: widthSchema,
  height: heightSchema,
};

const WORK_ITEM_STRUCTURED_MOCKUP_V5_ROLES = [
  'button',
  'heading',
  'img',
  'link',
  'list',
  'listitem',
  'navigation',
  'region',
  'status',
  'separator',
  'textbox',
  'none',
  'presentation',
] as const satisfies readonly WorkItemStructuredMockupSemanticRole[];
const WORK_ITEM_STRUCTURED_MOCKUP_V5_COLORS = [
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'info',
  'neutral',
  'muted',
  'surface',
  'transparent',
] as const satisfies readonly WorkItemStructuredMockupColor[];
const WORK_ITEM_STRUCTURED_MOCKUP_V5_OVERFLOW = [
  'visible',
  'hidden',
] as const satisfies readonly WorkItemStructuredMockupOverflow[];
const WORK_ITEM_STRUCTURED_MOCKUP_V5_DIRECTIONS = [
  'up',
  'right',
  'down',
  'left',
] as const satisfies readonly WorkItemStructuredMockupCaretDirection[];
const WORK_ITEM_STRUCTURED_MOCKUP_V5_SHAPES = [
  'circle',
  'square',
  'rounded',
  'pill',
  'diamond',
  'triangle',
] as const satisfies readonly WorkItemStructuredMockupShapeKind[];
const WORK_ITEM_STRUCTURED_MOCKUP_V5_ORIENTATIONS = [
  'horizontal',
  'vertical',
] as const satisfies readonly WorkItemStructuredMockupDividerOrientation[];
const WORK_ITEM_STRUCTURED_MOCKUP_V5_ICON_KEYS = [
  'task',
  'bug',
  'feature',
  'goal',
  'contract',
  'workflow',
  'plan',
  'plan-stage',
  'add',
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'arrow-up',
  'check',
  'close',
  'edit',
  'info',
  'menu',
  'search',
  'settings',
  'star',
  'warning',
] as const satisfies readonly WorkItemStructuredMockupIconKey[];

const structuredMockupJustifySchema = z.nativeEnum(
  WorkItemStructuredMockupContainerProps.JustifyEnum,
);
const structuredMockupAlignSchema = z.nativeEnum(
  WorkItemStructuredMockupContainerProps.AlignEnum,
);

const v5AppearanceProps = {
  role: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_ROLES).optional(),
  description: z.string().min(1).optional(),
  color: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_COLORS).optional(),
  opacity: z.number().min(0).max(1).optional(),
  overflow: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_OVERFLOW).optional(),
};

const textComponentSchema = z
  .object({
    type: z.literal('text'),
    props: z
      .object({
        ...layoutProps,
        text: z.string(),
        variant: z
          .nativeEnum(WorkItemStructuredMockupTextProps.VariantEnum)
          .optional(),
      })
      .strict(),
  })
  .strict();
const buttonComponentSchema = z
  .object({
    type: z.literal('button'),
    props: z.object({ ...layoutProps, label: z.string() }).strict(),
  })
  .strict();
const inputComponentSchema = z
  .object({
    type: z.literal('input'),
    props: z
      .object({
        ...layoutProps,
        label: z.string(),
        placeholder: z.string(),
        value: z.string().optional(),
        multiline: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
const surfaceComponentSchema = (type: 'card' | 'rectangle') =>
  z
    .object({
      type: z.literal(type),
      props: z
        .object({ ...layoutProps, label: z.string().optional() })
        .strict(),
    })
    .strict();
const dividerComponentSchema = z
  .object({
    type: z.literal('divider'),
    props: z.object(layoutProps).strict(),
  })
  .strict();
const imagePlaceholderComponentSchema = z
  .object({
    type: z.literal('image-placeholder'),
    props: z.object({ ...layoutProps, altText: z.string() }).strict(),
  })
  .strict();

const componentSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion('type', [
    textComponentSchema,
    buttonComponentSchema,
    inputComponentSchema,
    surfaceComponentSchema('card'),
    surfaceComponentSchema('rectangle'),
    dividerComponentSchema,
    imagePlaceholderComponentSchema,
    containerComponentSchema('row'),
    containerComponentSchema('column'),
  ]),
);

const componentV4Schema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion('type', [
    textComponentSchema,
    buttonComponentSchema,
    inputComponentSchema,
    surfaceComponentSchema('card'),
    surfaceComponentSchema('rectangle'),
    dividerComponentSchema,
    imagePlaceholderComponentSchema,
    containerV4Schema('row'),
    containerV4Schema('column'),
    z
      .object({
        type: z.literal('slot'),
        props: z
          .object({
            ...layoutProps,
            name: z.string().min(1),
            surface: z.enum(['plain', 'panel', 'muted', 'dashed']).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal('icon'),
        props: z
          .object({
            ...layoutProps,
            iconKey: z.string().min(1),
            accessibleLabel: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal('mockup-occurrence'),
        props: z
          .object({
            ...layoutProps,
            sourceMockupId: z.string().uuid(),
            slotAssignments: z.array(
              z
                .object({
                  slotName: z.string().min(1),
                  children: z.array(componentV4Schema),
                })
                .strict(),
            ),
          })
          .strict(),
      })
      .strict(),
  ]),
);

function containerV4Schema(type: 'row' | 'column') {
  return containerComponentSchema(type).extend({
    children: z.array(componentV4Schema),
  });
}

function containerComponentSchema(type: 'row' | 'column') {
  return z
    .object({
      type: z.literal(type),
      props: z
        .object({
          ...layoutProps,
          gap: z.number().int().nonnegative(),
          padding: z.number().int().nonnegative(),
          justify: structuredMockupJustifySchema,
          align: structuredMockupAlignSchema,
          surface: z
            .nativeEnum(WorkItemStructuredMockupContainerProps.SurfaceEnum)
            .optional(),
        })
        .strict(),
      children: z.array(componentSchema),
    })
    .strict();
}

const annotationAuthorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('human'), userId: z.string().uuid() }).strict(),
  z
    .object({ type: z.literal('agent'), agentSessionId: z.string().uuid() })
    .strict(),
]);

const annotationTargetSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('component'), componentId: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal('position'),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .strict(),
]);

const annotationSchema = z
  .object({
    id: z.string().uuid(),
    note: z.string().min(1).max(4000),
    author: annotationAuthorSchema,
    category: z.enum(['context', 'suggestion', 'question', 'issue']),
    lifecycle: z.enum(['open', 'resolved']),
    authoredProposalId: z.string().uuid(),
    authoredSizeKey: z.string().min(1),
    target: annotationTargetSchema,
  })
  .strict();

const structuredMockupDocumentSchema = z
  .object({
    schemaVersion: z.string(),
    revision: z.number().int().positive(),
    content: z.array(z.unknown()),
    sizeKey: z.string().min(1).optional(),
    annotations: z.array(annotationSchema),
  })
  .strict();

const structuredMockupV3Schema = structuredMockupDocumentSchema.extend({
  schemaVersion: z.literal(WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3),
  content: z.array(componentSchema),
});
const structuredMockupV4Schema = structuredMockupDocumentSchema.extend({
  schemaVersion: z.literal(WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V4),
  content: z.array(componentV4Schema),
});

const v5TextComponentSchema = z
  .object({
    type: z.literal('text'),
    props: z
      .object({
        ...layoutProps,
        ...v5AppearanceProps,
        text: z.string(),
        variant: z
          .nativeEnum(WorkItemStructuredMockupTextProps.VariantEnum)
          .optional(),
      })
      .strict(),
  })
  .strict();
const v5ButtonComponentSchema = z
  .object({
    type: z.literal('button'),
    props: z
      .object({ ...layoutProps, ...v5AppearanceProps, label: z.string() })
      .strict(),
  })
  .strict();
const v5InputComponentSchema = z
  .object({
    type: z.literal('input'),
    props: z
      .object({
        ...layoutProps,
        ...v5AppearanceProps,
        label: z.string(),
        placeholder: z.string(),
        value: z.string().optional(),
        multiline: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
const v5SurfaceComponentSchema = (type: 'card' | 'rectangle') =>
  z
    .object({
      type: z.literal(type),
      props: z
        .object({
          ...layoutProps,
          ...v5AppearanceProps,
          label: z.string().optional(),
        })
        .strict(),
    })
    .strict();
const v5ImagePlaceholderComponentSchema = z
  .object({
    type: z.literal('image-placeholder'),
    props: z
      .object({ ...layoutProps, ...v5AppearanceProps, altText: z.string() })
      .strict(),
  })
  .strict();
const v5DividerComponentSchema = z
  .object({
    type: z.literal('divider'),
    props: z
      .object({
        ...layoutProps,
        ...v5AppearanceProps,
        orientation: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_ORIENTATIONS),
      })
      .strict(),
  })
  .strict();
const v5IconComponentSchema = z
  .object({
    type: z.literal('icon'),
    props: z
      .object({
        ...layoutProps,
        ...v5AppearanceProps,
        iconKey: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_ICON_KEYS),
        accessibleLabel: z.string().min(1),
      })
      .strict(),
  })
  .strict();
const v5CaretComponentSchema = z
  .object({
    type: z.literal('caret'),
    props: z
      .object({
        ...layoutProps,
        ...v5AppearanceProps,
        direction: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_DIRECTIONS),
      })
      .strict(),
  })
  .strict();
const v5ShapeComponentSchema = z
  .object({
    type: z.literal('shape'),
    props: z
      .object({
        ...layoutProps,
        ...v5AppearanceProps,
        kind: z.enum(WORK_ITEM_STRUCTURED_MOCKUP_V5_SHAPES),
      })
      .strict(),
  })
  .strict();

const componentV5Schema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion('type', [
    v5TextComponentSchema,
    v5ButtonComponentSchema,
    v5InputComponentSchema,
    v5SurfaceComponentSchema('card'),
    v5SurfaceComponentSchema('rectangle'),
    v5ImagePlaceholderComponentSchema,
    v5DividerComponentSchema,
    v5IconComponentSchema,
    v5CaretComponentSchema,
    v5ShapeComponentSchema,
    v5ContainerComponentSchema('row'),
    v5ContainerComponentSchema('column'),
    z
      .object({
        type: z.literal('slot'),
        props: z
          .object({
            ...layoutProps,
            ...v5AppearanceProps,
            name: z.string().min(1),
            surface: z.enum(['plain', 'panel', 'muted', 'dashed']).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal('mockup-occurrence'),
        props: z
          .object({
            ...layoutProps,
            ...v5AppearanceProps,
            sourceMockupId: z.string().uuid(),
            slotAssignments: z.array(
              z
                .object({
                  slotName: z.string().min(1),
                  children: z.array(componentV5Schema),
                })
                .strict(),
            ),
          })
          .strict(),
      })
      .strict(),
  ]),
);

function v5ContainerComponentSchema(type: 'row' | 'column') {
  return z
    .object({
      type: z.literal(type),
      props: z
        .object({
          ...layoutProps,
          ...v5AppearanceProps,
          gap: z.number().int().nonnegative(),
          padding: z.number().int().nonnegative(),
          justify: structuredMockupJustifySchema,
          align: structuredMockupAlignSchema,
          surface: z.enum(['plain', 'panel', 'muted', 'dashed']).optional(),
        })
        .strict(),
      children: z.array(componentV5Schema),
    })
    .strict();
}

const structuredMockupV5Schema = structuredMockupDocumentSchema.extend({
  schemaVersion: z.literal(WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V5),
  content: z.array(componentV5Schema),
});

const structuredMockupSchema = z.discriminatedUnion('schemaVersion', [
  structuredMockupV3Schema,
  structuredMockupV4Schema,
  structuredMockupV5Schema,
]);

export type WorkItemStructuredMockupValidationResult =
  | { success: true; canonicalContent: string }
  | {
      success: false;
      message: string;
      path?: Array<string | number>;
    };

type StructuredMockupPath = Array<string | number>;

const SUPPORTED_STRUCTURED_MOCKUP_SCHEMA_VERSIONS = [
  WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
  WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V4,
  WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V5,
] as const;

function formatStructuredMockupPath(path: StructuredMockupPath): string {
  if (path.length === 0) return 'root';
  return path.reduce<string>(
    (formatted, segment) =>
      typeof segment === 'number'
        ? `${formatted}[${segment}]`
        : formatted.length === 0
          ? String(segment)
          : `${formatted}.${segment}`,
    '',
  );
}

function schemaValidationFailure(
  issues: ReadonlyArray<{
    path: ReadonlyArray<string | number>;
    message: string;
  }>,
): WorkItemStructuredMockupValidationResult {
  const firstIssue = issues[0];
  const details = issues
    .map(
      (issue) =>
        `${formatStructuredMockupPath([...issue.path])}: ${issue.message}`,
    )
    .join('; ');
  return {
    success: false,
    path: firstIssue ? [...firstIssue.path] : undefined,
    message:
      `Structured mockup content must use one of ${SUPPORTED_STRUCTURED_MOCKUP_SCHEMA_VERSIONS.map((version) => `'${version}'`).join(', ')} ` +
      `and match its strict schema${details ? ` (${details})` : '.'}`,
  };
}

export function validateWorkItemStructuredMockupContent(
  content: unknown,
  allowedSizeKeys?: ReadonlySet<string>,
): WorkItemStructuredMockupValidationResult {
  let value = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      return {
        success: false,
        message: 'Structured mockup content must contain valid JSON.',
      };
    }
  }

  let parsed: ReturnType<typeof structuredMockupSchema.safeParse>;
  try {
    parsed = structuredMockupSchema.safeParse(value);
  } catch {
    return {
      success: false,
      message:
        'Structured mockup content is too deeply nested to validate safely.',
      path: ['content'],
    };
  }
  if (!parsed.success) {
    return schemaValidationFailure(parsed.error.issues);
  }

  if (parsed.data.sizeKey && !allowedSizeKeys?.has(parsed.data.sizeKey)) {
    return {
      success: false,
      message: `Structured mockup content references unknown sizeKey '${parsed.data.sizeKey}'.`,
      path: ['sizeKey'],
    };
  }

  const ids = new Set<string>();
  const stack: Array<{
    component: unknown;
    path: StructuredMockupPath;
  }> = parsed.data.content
    .map((component, index) => ({
      component,
      path: ['content', index],
    }))
    .reverse();
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    const component = entry.component as {
      props: { id: string };
      children?: unknown[];
    };
    if (ids.has(component.props.id)) {
      return {
        success: false,
        message: `Structured mockup component id '${component.props.id}' must be unique within the document.`,
        path: [...entry.path, 'props', 'id'],
      };
    }
    ids.add(component.props.id);
    if (component.children) {
      stack.push(
        ...component.children
          .map((child, index) => ({
            component: child,
            path: [...entry.path, 'children', index],
          }))
          .reverse(),
      );
    }
    const props = component.props as {
      id: string;
      sourceMockupId?: string;
      slotAssignments?: Array<{ slotName: string; children: unknown[] }>;
    };
    if (props.sourceMockupId === props.id) {
      return {
        success: false,
        message:
          'Structured mockup occurrence id must be distinct from its sourceMockupId.',
        path: [...entry.path, 'props', 'sourceMockupId'],
      };
    }
    if (props.slotAssignments) {
      const slotNames = new Set<string>();
      for (const [
        assignmentIndex,
        assignment,
      ] of props.slotAssignments.entries()) {
        if (slotNames.has(assignment.slotName))
          return {
            success: false,
            message: `Structured mockup slot assignment '${assignment.slotName}' must be unique within an occurrence.`,
            path: [
              ...entry.path,
              'props',
              'slotAssignments',
              assignmentIndex,
              'slotName',
            ],
          };
        slotNames.add(assignment.slotName);
        stack.push(
          ...assignment.children
            .map((child, childIndex) => ({
              component: child,
              path: [
                ...entry.path,
                'props',
                'slotAssignments',
                assignmentIndex,
                'children',
                childIndex,
              ],
            }))
            .reverse(),
        );
      }
    }
  }

  const annotationIds = new Set<string>();
  for (const [
    annotationIndex,
    annotation,
  ] of parsed.data.annotations.entries()) {
    if (annotationIds.has(annotation.id)) {
      return {
        success: false,
        message: `Structured mockup annotation id '${annotation.id}' must be unique within the section.`,
        path: ['annotations', annotationIndex, 'id'],
      };
    }
    annotationIds.add(annotation.id);
  }

  return {
    success: true,
    canonicalContent: JSON.stringify(parsed.data),
  };
}
