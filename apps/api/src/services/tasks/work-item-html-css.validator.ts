import { z } from 'zod';
import { WorkItemHtmlCssAnnotationElementTarget } from '../../generated/model/workItemHtmlCssAnnotationElementTarget';
import { WorkItemHtmlCssAnnotationPositionTarget } from '../../generated/model/workItemHtmlCssAnnotationPositionTarget';
import { WorkItemStructuredMockupAnnotationAgentAuthor } from '../../generated/model/workItemStructuredMockupAnnotationAgentAuthor';
import { WorkItemStructuredMockupAnnotationCategory } from '../../generated/model/workItemStructuredMockupAnnotationCategory';
import { WorkItemStructuredMockupAnnotationHumanAuthor } from '../../generated/model/workItemStructuredMockupAnnotationHumanAuthor';
import { WorkItemStructuredMockupAnnotationLifecycle } from '../../generated/model/workItemStructuredMockupAnnotationLifecycle';

type HtmlCssValidationResult =
  | { success: true; canonicalContent: string }
  | { success: false; message: string; path?: Array<string | number> };

const annotationAuthorSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal(
        WorkItemStructuredMockupAnnotationHumanAuthor.TypeEnum.Human,
      ),
      userId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal(
        WorkItemStructuredMockupAnnotationAgentAuthor.TypeEnum.Agent,
      ),
      agentSessionId: z.string().uuid(),
    })
    .strict(),
]);

const annotationTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal(WorkItemHtmlCssAnnotationElementTarget.TypeEnum.Element),
      nodeId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal(
        WorkItemHtmlCssAnnotationPositionTarget.TypeEnum.Position,
      ),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      sizeKey: z.string().min(1),
    })
    .strict(),
]);

const annotationSchema = z
  .object({
    id: z.string().uuid(),
    note: z.string().min(1).max(4000),
    author: annotationAuthorSchema,
    category: z.nativeEnum(WorkItemStructuredMockupAnnotationCategory),
    lifecycle: z.nativeEnum(WorkItemStructuredMockupAnnotationLifecycle),
    authoredProposalId: z.string().uuid(),
    authoredSizeKey: z.string().min(1),
    target: annotationTargetSchema,
  })
  .strict();

const htmlCssSectionContentSchema = z
  .object({
    html: z.string(),
    css: z.string(),
    sizeKey: z.string().min(1).optional(),
    annotations: z.array(annotationSchema).optional(),
  })
  .strict();

const schemaFailure = (issues: z.ZodIssue[]): HtmlCssValidationResult => ({
  success: false,
  message: issues[0]?.message ?? 'Invalid HTML/CSS section content.',
  path: issues[0]?.path,
});

export const validateWorkItemHtmlCssContent = (
  content: unknown,
  allowedSizeKeys: ReadonlySet<string>,
): HtmlCssValidationResult => {
  let value = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      return {
        success: false,
        message: 'HTML/CSS section content must contain valid JSON.',
      };
    }
  }

  const parsed = htmlCssSectionContentSchema.safeParse(value);
  if (!parsed.success) return schemaFailure(parsed.error.issues);

  if (parsed.data.sizeKey && !allowedSizeKeys.has(parsed.data.sizeKey)) {
    return {
      success: false,
      message: `HTML/CSS section content references unknown sizeKey '${parsed.data.sizeKey}'.`,
      path: ['sizeKey'],
    };
  }

  const annotationSizeKeys =
    allowedSizeKeys.size > 0 ? allowedSizeKeys : new Set(['default']);
  const annotationIds = new Set<string>();
  for (const [index, annotation] of (parsed.data.annotations ?? []).entries()) {
    if (annotationIds.has(annotation.id)) {
      return {
        success: false,
        message: `HTML/CSS annotation id '${annotation.id}' must be unique within the section.`,
        path: ['annotations', index, 'id'],
      };
    }
    annotationIds.add(annotation.id);

    if (!annotationSizeKeys.has(annotation.authoredSizeKey)) {
      return {
        success: false,
        message: `HTML/CSS annotation references unknown authoredSizeKey '${annotation.authoredSizeKey}'.`,
        path: ['annotations', index, 'authoredSizeKey'],
      };
    }
    if (
      annotation.target.type === 'position' &&
      !annotationSizeKeys.has(annotation.target.sizeKey)
    ) {
      return {
        success: false,
        message: `HTML/CSS positional annotation references unknown sizeKey '${annotation.target.sizeKey}'.`,
        path: ['annotations', index, 'target', 'sizeKey'],
      };
    }
  }

  return { success: true, canonicalContent: JSON.stringify(parsed.data) };
};
