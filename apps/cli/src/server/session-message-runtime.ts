import { createHash } from 'node:crypto';
import { z } from 'zod';
import { z as durable } from 'zod/v4';
import { canonicalizeJson } from './trigger-verification/jcs';
import { collaborationPayloadSchema } from './input-admission/admission-lifecycle';
import { storedInput } from './input-admission/input-admission-codec';
import {
  AgentSessionsApi,
  TurnAdmissionSource,
  TurnAdmissionState,
  TurnAdmissionAuthorKindEnum,
  type SessionMessageInput,
  type TurnAdmission,
} from '../shared/api/generated/api';
import { Configuration } from '../shared/api/generated/configuration';
import type { KeyPairStore } from '../credentials/keypair';
import type { RunStore } from '../run-store/run-store';
import type { LocalAgentService } from './local-agent-service';

type Scope = {
  organizationId: string;
  projectId: string;
  targetSessionId: string;
  admissionId: string;
  turnId?: string;
};

export function verifySessionMessageAdmission(
  admission: TurnAdmission,
  target: Scope,
  machineId: string,
): SessionMessageInput {
  if (
    admission.id !== target.admissionId ||
    admission.agentSessionId !== target.targetSessionId ||
    admission.source !== 'AGENT_INTERACTION' ||
    admission.authorKind !== 'AGENT' ||
    !admission.sessionMessageInput
  ) {
    throw new Error('The claimed Turn is not the expected agent-authored admission.');
  }
  const input = admission.sessionMessageInput;
  if (
    input.authorKind !== 'AGENT' ||
    input.attemptId !== admission.interactionAttemptId ||
    input.authority.machineId !== machineId ||
    input.authority.targetSessionId !== target.targetSessionId ||
    input.authority.sourceSessionId !== input.sourceSessionId ||
    input.authority.subagentCapability !== 'RESEARCH' ||
    (input.answerReference !== undefined &&
      (!input.answerText || input.answerText.length > 16000)) ||
    (input.answerReference === undefined && input.answerText !== undefined) ||
    (input.objective === undefined) === (input.answerReference === undefined)
  ) {
    throw new Error(
      'The claimed session-message provenance does not match its admitted authority.',
    );
  }
  return input;
}

const admissionSchema = z.object({
  id: z.string().uuid(),
  agentSessionId: z.string().uuid(),
  source: z.nativeEnum(TurnAdmissionSource),
  state: z.nativeEnum(TurnAdmissionState),
  ordinal: z.number().int(),
  generation: z.number().int(),
  idempotencyKey: z.string(),
  authorKind: z.nativeEnum(TurnAdmissionAuthorKindEnum),
  authorUserId: z.string().optional(),
  inputMessageId: z.string().optional(),
  interactionAttemptId: z.string().optional(),
  sessionMessageInput: collaborationPayloadSchema.shape.input.optional(),
  turnId: z.string().optional(),
  createdAt: z.string(),
});
const targetsSchema = z.object({
  data: z.object({
    targets: z.array(
      z.object({
        organizationId: z.string().uuid(),
        projectId: z.string().uuid(),
        targetSessionId: z.string().uuid(),
        userId: z.string().uuid(),
        admissionId: z.string().uuid(),
        admission: admissionSchema,
      }),
    ),
  }),
});

/** One poll's session-message targets for the current machine. */
export interface SessionMessageTargets {
  machineId: string;
  targets: z.infer<typeof targetsSchema>['data']['targets'];
}

export async function pollSessionMessageTargets(deps: {
  keyPairStore: KeyPairStore;
  apiBaseUrl: string;
}): Promise<SessionMessageTargets | null> {
  const machineId = await deps.keyPairStore.loadCurrentMachineId();
  if (!machineId) return null;
  const credential = await deps.keyPairStore.loadMachineCredential(machineId);
  if (!credential) return null;
  const api = new AgentSessionsApi(
    new Configuration({ accessToken: credential, basePath: deps.apiBaseUrl }),
  );
  const targets = targetsSchema.parse((await api.listSessionMessageTargets()).data).data.targets;
  return { machineId, targets };
}

/** Transports machine-owned collaboration inputs into the shared local admission owner. */
export class SessionMessageRuntime {
  public constructor(
    private readonly deps: {
      runStore: RunStore;
      agentService: LocalAgentService;
    },
  ) {}
  public async receive({ machineId, targets }: SessionMessageTargets): Promise<void> {
    const admitted = new Set<string>();
    for (const target of targets) {
      const runId = this.deps.runStore.lookupByAgentSessionId(target.targetSessionId);
      if (!runId) continue;
      const run = await this.deps.runStore.getRun(runId);
      if (
        !run ||
        run.contextMetadata.agentSessionId !== target.targetSessionId ||
        run.contextMetadata.organizationId !== target.organizationId ||
        run.contextMetadata.projectId !== target.projectId
      )
        throw new Error('The local Run does not own the collaboration input.');
      const input = verifySessionMessageAdmission(
        target.admission as TurnAdmission,
        target,
        machineId,
      );
      const payload = durable.json().parse({
        kind: 'session_message',
        input,
        generation: target.admission.generation,
        platformAdmissionId: target.admissionId,
      });
      await this.deps.agentService.inputAdmission.owner.admit(
        {
          key: target.admissionId,
          fingerprint: createHash('sha256').update(canonicalizeJson(payload)).digest('hex'),
          agentSessionId: target.targetSessionId,
          runId,
          organizationId: target.organizationId,
          projectId: target.projectId,
          userId: target.userId,
          machineId,
          messageId: null,
        },
        storedInput('session_message', 'operation', payload),
        // No submission response waits on a collaboration input; pickup decides when it runs.
        () => false,
      );
      admitted.add(target.targetSessionId);
    }
    for (const sessionId of admitted) void this.deps.agentService.inputAdmission.advance(sessionId);
  }
}
