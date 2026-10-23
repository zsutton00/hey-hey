import type { JsonObject, JsonValue, PlatformMcpProxyResult } from './session';

const PROPOSAL_AUTHORING_TOOLS: ReadonlySet<string> = new Set([
  'create_plan',
  'edit_plan',
  'create_work_item',
  'edit_work_item',
  'edit_tasks',
  'create_work_item_type',
  'edit_work_item_type',
  'create_design_doc',
  'edit_design_doc',
  'propose_future_revision',
  'create_stage',
  'update_stage',
  'delete_stage',
  'reorder_stages',
  'create_step',
  'create_steps',
  'update_step',
  'delete_step',
  'move_step',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readSuccessfulResult = (response: PlatformMcpProxyResult): JsonObject | null => {
  if (response.statusCode !== 200 || !response.body || !('result' in response.body)) return null;
  if (!isJsonObject(response.body.result) || response.body.result['isError'] === true) return null;
  return response.body.result;
};

const readJsonText = (value: JsonValue): JsonValue | null => {
  if (!isJsonObject(value) || value['type'] !== 'text' || typeof value['text'] !== 'string') {
    return null;
  }
  try {
    const parsed: JsonValue = JSON.parse(value['text']);
    return parsed;
  } catch {
    return null;
  }
};

const readCreatePlanProposalId = (result: JsonObject): string | null => {
  const directId = result['id'];
  if (typeof directId === 'string' && UUID_PATTERN.test(directId)) return directId;

  const structuredContent = result['structuredContent'];
  if (!isJsonObject(structuredContent)) return null;

  const structuredId = structuredContent['id'];
  return typeof structuredId === 'string' && UUID_PATTERN.test(structuredId) ? structuredId : null;
};

const collectProposalIds = (value: JsonValue, found: string[]): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectProposalIds(entry, found);
    return;
  }
  if (!isJsonObject(value)) return;

  const proposalId = value['proposalId'];
  if (typeof proposalId === 'string' && UUID_PATTERN.test(proposalId)) {
    found.push(proposalId);
  }

  const proposalIds = value['proposalIds'];
  if (Array.isArray(proposalIds)) {
    for (const id of proposalIds) {
      if (typeof id === 'string' && UUID_PATTERN.test(id)) {
        found.push(id);
      }
    }
  }

  const proposals = value['proposals'];
  if (Array.isArray(proposals)) {
    for (const proposal of proposals) {
      if (!isJsonObject(proposal)) continue;
      const id = proposal['proposalId'] ?? proposal['id'];
      if (typeof id === 'string' && UUID_PATTERN.test(id)) {
        found.push(id);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'proposalId' || key === 'proposalIds' || key === 'proposals') continue;
    if (key === 'content' && Array.isArray(child)) {
      for (const block of child) {
        const parsed = readJsonText(block);
        if (parsed !== null) collectProposalIds(parsed, found);
      }
      continue;
    }
    collectProposalIds(child, found);
  }
};

export const readCreatedProposalIds = (
  toolName: string,
  response: PlatformMcpProxyResult,
): string[] => {
  if (!PROPOSAL_AUTHORING_TOOLS.has(toolName)) return [];
  const result = readSuccessfulResult(response);
  if (!result) return [];

  const found: string[] = [];
  // create_plan's output schema names its proposal identity `id`. Other
  // authoring tools use proposalId, while a generic top-level `id` may be an
  // entity identity, so keep this compatibility path tool-specific.
  if (toolName === 'create_plan') {
    const proposalId = readCreatePlanProposalId(result);
    if (proposalId) found.push(proposalId);
  }
  collectProposalIds(result, found);
  return Array.from(new Set(found));
};

export interface CreatedProposalGroupMember {
  memberId: string;
  proposalId: string;
}

const collectCreatedProposalGroupMembers = (
  value: JsonValue,
  found: CreatedProposalGroupMember[],
): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectCreatedProposalGroupMembers(entry, found);
    return;
  }
  if (!isJsonObject(value)) return;

  const proposalId = value['proposalId'];
  const groupedAuthoring = value['groupedAuthoring'];
  if (
    typeof proposalId === 'string' &&
    UUID_PATTERN.test(proposalId) &&
    isJsonObject(groupedAuthoring)
  ) {
    const member = groupedAuthoring['member'];
    if (isJsonObject(member) && typeof member['memberId'] === 'string') {
      found.push({ memberId: member['memberId'], proposalId });
    }
  }

  const proposals = value['proposals'];
  const members = isJsonObject(groupedAuthoring) ? groupedAuthoring['members'] : undefined;
  if (Array.isArray(proposals) && Array.isArray(members) && proposals.length === members.length) {
    for (const [index, proposal] of proposals.entries()) {
      const member = members[index];
      if (!isJsonObject(proposal) || !isJsonObject(member)) continue;
      const batchProposalId = proposal['proposalId'] ?? proposal['id'];
      const memberId = member['memberId'];
      if (
        typeof batchProposalId === 'string' &&
        UUID_PATTERN.test(batchProposalId) &&
        typeof memberId === 'string'
      ) {
        found.push({ memberId, proposalId: batchProposalId });
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'content' && Array.isArray(child)) {
      for (const block of child) {
        const parsed = readJsonText(block);
        if (parsed !== null) collectCreatedProposalGroupMembers(parsed, found);
      }
      continue;
    }
    collectCreatedProposalGroupMembers(child, found);
  }
};

export const readCreatedProposalGroupMembers = (
  toolName: string,
  response: PlatformMcpProxyResult,
): CreatedProposalGroupMember[] => {
  if (!PROPOSAL_AUTHORING_TOOLS.has(toolName)) return [];
  const result = readSuccessfulResult(response);
  if (!result) return [];

  const found: CreatedProposalGroupMember[] = [];
  collectCreatedProposalGroupMembers(result, found);
  return Array.from(new Map(found.map((membership) => [membership.memberId, membership])).values());
};

export const readRemovedProposalGroupMemberId = (
  toolName: string,
  requestArguments: JsonValue | undefined,
  response: PlatformMcpProxyResult,
): string | null => {
  if (toolName !== 'remove_proposal_group_member' || !readSuccessfulResult(response)) return null;
  if (!isJsonObject(requestArguments)) return null;
  const memberId = requestArguments['memberId'];
  return typeof memberId === 'string' ? memberId : null;
};

export const readDeletedProposalId = (
  toolName: string,
  requestArguments: JsonValue | undefined,
  response: PlatformMcpProxyResult,
): string | null => {
  if (toolName !== 'delete_proposal' || !readSuccessfulResult(response)) return null;
  if (!isJsonObject(requestArguments)) return null;
  const proposalId = requestArguments['proposalId'];
  return typeof proposalId === 'string' && UUID_PATTERN.test(proposalId) ? proposalId : null;
};
