import type { z } from 'zod';
import { DiagramGroupsValueSchema } from '../../generated/diagram.schemas';

export const DIAGRAM_GROUPS_SECTION_KEY = 'diagramGroups';
export const DIAGRAM_GROUPS_SCHEMA_REF =
  '#/components/schemas/DiagramGroupsValue';
export const DIAGRAM_GROUPS_SCHEMA_VERSION = 'diagram-groups.v1';

export type DiagramGroupsValue = z.infer<typeof DiagramGroupsValueSchema>;
export type DiagramGroup = DiagramGroupsValue['groups'][number];
export type DiagramGroupMember = DiagramGroup['members'][number];

const FACTUAL_MEANINGS = new Set<DiagramGroup['meaning']>([
  'STRUCTURAL_BOUNDARY',
  'DEPLOYMENT_BOUNDARY',
]);

export type DiagramGroupsIssue = {
  path: string;
  code:
    | 'invalid_diagram_groups'
    | 'duplicate_group_id'
    | 'unknown_parent_group'
    | 'group_cycle'
    | 'factual_boundary_inside_visual_group'
    | 'duplicate_group_member'
    | 'multiple_factual_boundaries'
    | 'dangling_group_member';
  message: string;
};

export function isFactualDiagramGroup(group: Pick<DiagramGroup, 'meaning'>) {
  return FACTUAL_MEANINGS.has(group.meaning);
}

/**
 * Change-set and persisted keys share one shape so projector, materializer
 * and TaskService compare the same identity.
 */
export function diagramGroupMemberKey(member: DiagramGroupMember): string {
  return member.kind === 'persistedWorkItem'
    ? `existing:${member.workItemId}`
    : `temporary:${member.temporaryRef}`;
}

export function parseDiagramGroupsContent(
  content: unknown,
):
  | { success: true; value: DiagramGroupsValue }
  | { success: false; message: string } {
  let raw = content;
  if (typeof content === 'string') {
    try {
      raw = JSON.parse(content);
    } catch (error) {
      return {
        success: false,
        message: `content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const result = DiagramGroupsValueSchema.safeParse(raw);
  if (!result.success) {
    return {
      success: false,
      message: result.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { success: true, value: canonicalizeDiagramGroups(result.data) };
}

/** Stable key order so stored content compares byte-for-byte. */
export function canonicalizeDiagramGroups(
  value: DiagramGroupsValue,
): DiagramGroupsValue {
  return {
    schemaVersion: value.schemaVersion,
    groups: value.groups.map((group) => ({
      id: group.id,
      label: group.label,
      meaning: group.meaning,
      ...(group.color !== undefined ? { color: group.color } : {}),
      ...(group.parentGroupId ? { parentGroupId: group.parentGroupId } : {}),
      members: group.members.map((member) =>
        member.kind === 'persistedWorkItem'
          ? { kind: member.kind, workItemId: member.workItemId }
          : { kind: member.kind, temporaryRef: member.temporaryRef },
      ),
    })),
  };
}

/**
 * Structural rules independent of which elements exist. When
 * `elementKeys` is supplied every member must resolve to one of them.
 */
export function validateDiagramGroups(
  value: DiagramGroupsValue,
  elementKeys?: ReadonlySet<string>,
): DiagramGroupsIssue[] {
  const issues: DiagramGroupsIssue[] = [];
  const byId = new Map<string, DiagramGroup>();
  value.groups.forEach((group, index) => {
    if (byId.has(group.id)) {
      issues.push({
        path: `groups[${index}].id`,
        code: 'duplicate_group_id',
        message: `Group id ${group.id} appears more than once.`,
      });
    }
    byId.set(group.id, group);
  });

  value.groups.forEach((group, index) => {
    if (!group.parentGroupId) return;
    const parent = byId.get(group.parentGroupId);
    if (!parent) {
      issues.push({
        path: `groups[${index}].parentGroupId`,
        code: 'unknown_parent_group',
        message: `Group ${group.id} names unknown parent group ${group.parentGroupId}.`,
      });
      return;
    }
    if (isFactualDiagramGroup(group) && !isFactualDiagramGroup(parent)) {
      issues.push({
        path: `groups[${index}].parentGroupId`,
        code: 'factual_boundary_inside_visual_group',
        message: `Boundary ${group.id} cannot sit inside visual association group ${parent.id}.`,
      });
    }
    const seen = new Set<string>([group.id]);
    let current: DiagramGroup | undefined = parent;
    while (current) {
      if (seen.has(current.id)) {
        issues.push({
          path: `groups[${index}].parentGroupId`,
          code: 'group_cycle',
          message: `Group ${group.id} is nested inside itself.`,
        });
        break;
      }
      seen.add(current.id);
      current = current.parentGroupId
        ? byId.get(current.parentGroupId)
        : undefined;
    }
  });

  const factualOwner = new Map<string, string>();
  value.groups.forEach((group, groupIndex) => {
    const members = new Set<string>();
    group.members.forEach((member, memberIndex) => {
      const key = diagramGroupMemberKey(member);
      const path = `groups[${groupIndex}].members[${memberIndex}]`;
      if (members.has(key)) {
        issues.push({
          path,
          code: 'duplicate_group_member',
          message: `Element ${key} appears more than once in group ${group.id}.`,
        });
      }
      members.add(key);
      if (elementKeys && !elementKeys.has(key)) {
        issues.push({
          path,
          code: 'dangling_group_member',
          message: `Group ${group.id} member ${key} is not an element of this Diagram.`,
        });
      }
      if (!isFactualDiagramGroup(group)) return;
      const owner = factualOwner.get(key);
      if (owner && owner !== group.id) {
        issues.push({
          path,
          code: 'multiple_factual_boundaries',
          message: `Element ${key} sits directly inside boundaries ${owner} and ${group.id}; place it in the innermost boundary only.`,
        });
      }
      factualOwner.set(key, group.id);
    });
  });
  return issues;
}

/**
 * Lifecycle reconciliation: drop members whose elements were removed and
 * move children of removed groups to the nearest surviving ancestor (found
 * through `previous`), or to the top level. Saved positions are never read.
 */
export function reconcileDiagramGroups(
  value: DiagramGroupsValue,
  options: {
    removedMemberKeys?: ReadonlySet<string>;
    previous?: DiagramGroupsValue | null;
  } = {},
): DiagramGroupsValue {
  const removed = options.removedMemberKeys ?? new Set<string>();
  const surviving = new Set(value.groups.map((group) => group.id));
  const previousParent = new Map(
    (options.previous?.groups ?? []).map((group) => [
      group.id,
      group.parentGroupId,
    ]),
  );
  const resolveParent = (parentId: string | undefined) => {
    const seen = new Set<string>();
    let current = parentId;
    while (current && !surviving.has(current) && !seen.has(current)) {
      seen.add(current);
      current = previousParent.get(current);
    }
    return current && surviving.has(current) ? current : undefined;
  };
  return canonicalizeDiagramGroups({
    schemaVersion: value.schemaVersion,
    groups: value.groups.map((group) => {
      const parentGroupId = resolveParent(group.parentGroupId);
      return {
        id: group.id,
        label: group.label,
        meaning: group.meaning,
        ...(group.color !== undefined ? { color: group.color } : {}),
        ...(parentGroupId ? { parentGroupId } : {}),
        members: group.members.filter(
          (member) => !removed.has(diagramGroupMemberKey(member)),
        ),
      };
    }),
  });
}

/** Rewrite change-set-local refs to persisted IDs; temp IDs are never stored. */
export function materializeDiagramGroupMembers(
  value: DiagramGroupsValue,
  resolveTemporary: (temporaryRef: string) => string,
): DiagramGroupsValue {
  return canonicalizeDiagramGroups({
    schemaVersion: value.schemaVersion,
    groups: value.groups.map((group) => ({
      ...group,
      members: group.members.map((member) =>
        member.kind === 'temporaryWorkItem'
          ? {
              kind: 'persistedWorkItem' as const,
              workItemId: resolveTemporary(member.temporaryRef),
            }
          : member,
      ),
    })),
  });
}

export function formatDiagramGroupsIssues(
  issues: readonly DiagramGroupsIssue[],
): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}
