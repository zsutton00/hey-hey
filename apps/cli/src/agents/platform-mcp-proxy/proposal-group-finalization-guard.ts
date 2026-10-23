import type { McpSessionContext } from '../mcp-server-config';
import type { PlatformMcpForwarder } from './forwarder';
import type { JsonObject, JsonRpcRequest, JsonRpcResponse, JsonValue } from './session';

interface AuthoringMember {
  memberId: string;
  prerequisiteMemberIds: string[];
}

interface AuthoringSnapshot {
  members: AuthoringMember[];
}

const isObject = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readFinalizeGroupId = (request: JsonRpcRequest): string => {
  const argumentsValue = request.params?.['arguments'];
  if (!argumentsValue || !isObject(argumentsValue)) {
    throw new Error('finalize_proposal_group requires arguments');
  }
  const groupContext = argumentsValue['groupContext'];
  if (!groupContext || !isObject(groupContext)) {
    throw new Error('finalize_proposal_group requires groupContext');
  }
  const groupId = groupContext['groupId'];
  if (typeof groupId !== 'string' || groupId.length === 0) {
    throw new Error('finalize_proposal_group requires groupId');
  }
  return groupId;
};

const readMcpPayload = (result: JsonValue): JsonValue => {
  if (!isObject(result)) {
    throw new Error('Snapshot tool returned an invalid MCP result');
  }
  const structuredContent = result['structuredContent'];
  if (structuredContent !== undefined) {
    return structuredContent;
  }
  const content = result['content'];
  if (!Array.isArray(content)) {
    throw new Error('Snapshot tool returned no structured or text content');
  }
  const textBlock = content.find(
    (block): block is JsonObject =>
      isObject(block) && block['type'] === 'text' && typeof block['text'] === 'string',
  );
  if (!textBlock || typeof textBlock['text'] !== 'string') {
    throw new Error('Snapshot tool returned no JSON text content');
  }
  const parsed: JsonValue = JSON.parse(textBlock['text']);
  return parsed;
};

const readSnapshot = (result: JsonValue): AuthoringSnapshot => {
  const payload = readMcpPayload(result);
  if (!isObject(payload) || !Array.isArray(payload['members'])) {
    throw new Error('Snapshot tool returned an invalid authoring snapshot');
  }
  const members = payload['members'].map((value): AuthoringMember => {
    if (!isObject(value) || typeof value['memberId'] !== 'string') {
      throw new Error('Snapshot tool returned an invalid member');
    }
    const prerequisites = value['prerequisiteMemberIds'];
    if (
      !Array.isArray(prerequisites) ||
      !prerequisites.every((id): id is string => typeof id === 'string')
    ) {
      throw new Error('Snapshot tool returned invalid member prerequisites');
    }
    return {
      memberId: value['memberId'],
      prerequisiteMemberIds: prerequisites,
    };
  });
  return { members };
};

const isMcpError = (result: JsonValue): boolean => isObject(result) && result['isError'] === true;

const reject = (id: JsonRpcRequest['id'], text: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result: {
    content: [{ type: 'text', text }],
    isError: true,
  },
});

export class ProposalGroupFinalizationGuard {
  constructor(
    private readonly forwarder: PlatformMcpForwarder,
    private readonly context: McpSessionContext,
  ) {}

  async inspect(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const groupId = readFinalizeGroupId(request);
    const snapshotResponse = await this.forwarder.forward(
      {
        jsonrpc: '2.0',
        id: request.id,
        method: 'tools/call',
        params: {
          name: 'get_proposal_group_authoring_snapshot',
          arguments: { groupId },
        },
      },
      this.context,
    );

    if ('error' in snapshotResponse || isMcpError(snapshotResponse.result)) {
      return snapshotResponse;
    }

    const snapshot = readSnapshot(snapshotResponse.result);
    if (snapshot.members.length < 2) {
      return reject(
        request.id,
        'Proposal groups require at least two members before finalization. Add the dependent and prerequisite proposals, then retry.',
      );
    }

    const memberIds = new Set(snapshot.members.map(({ memberId }) => memberId));
    const hasGroupLocalPrerequisite = snapshot.members.some((member) =>
      member.prerequisiteMemberIds.some(
        (prerequisiteId) => prerequisiteId !== member.memberId && memberIds.has(prerequisiteId),
      ),
    );
    if (!hasGroupLocalPrerequisite) {
      return reject(
        request.id,
        'Proposal groups require at least one group-local proposal-level enactment prerequisite before finalization. Declare the complete prerequisite set, then retry.',
      );
    }

    return null;
  }
}
