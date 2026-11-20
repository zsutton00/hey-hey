import { z } from 'zod';

import type { FeatureRequirementRecord } from '@hey-hey/contracts/api/models';

const citationSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  entityTitle: z.string(),
});

const recordSchema = z.object({
  id: z.string().min(1),
  statement: z.string(),
  group: z.string().optional(),
  designedBy: z.array(citationSchema),
  fulfilledBy: z.array(citationSchema),
  contracts: z.array(citationSchema),
});

/** The stored requirements section body: `{ "records": [...] }`. */
export const requirementsDocumentSchema = z.object({ records: z.array(recordSchema) });

export type RequirementRecord = z.infer<typeof recordSchema>;

/** Compile-time check: every stored record from the generated contract is a valid parsed record. */
const generatedRecordIsParsable = (record: FeatureRequirementRecord) =>
  record satisfies RequirementRecord;
void generatedRecordIsParsable;
type RequirementCitation = RequirementRecord['designedBy'][number];

/** Parses a stored requirements section body; null when it is not valid requirements JSON. */
export const parseRequirementRecords = (
  materializedMarkdown: string,
): RequirementRecord[] | null => {
  let json: unknown;
  try {
    json = JSON.parse(materializedMarkdown);
  } catch {
    return null;
  }
  const parsed = requirementsDocumentSchema.safeParse(json);
  return parsed.success ? parsed.data.records : null;
};

const mention = (citation: RequirementCitation): string =>
  `@[${citation.entityType}:${citation.entityId}|${citation.entityTitle}]`;

const citationRole = (label: string, citations: readonly RequirementCitation[]): string | null =>
  citations.length > 0 ? `${label} ${citations.map(mention).join(', ')}` : null;

/** `- <statement> — designed by …; fulfilled by …; contracted by …`; empty roles are omitted. */
export const formatRequirementLine = (record: RequirementRecord): string => {
  const roles = [
    citationRole('designed by', record.designedBy),
    citationRole('fulfilled by', record.fulfilledBy),
    citationRole('contracted by', record.contracts),
  ].filter((role): role is string => role !== null);
  const tail = roles.length > 0 ? ` — ${roles.join('; ')}` : '';
  return `- ${record.statement.trim()}${tail}`;
};
