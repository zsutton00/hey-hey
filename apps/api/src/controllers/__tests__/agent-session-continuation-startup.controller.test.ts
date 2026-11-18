import { BadRequestException } from '@nestjs/common';
import { MachineAgentSessionContinuationController } from '../agent-session-continuation.controller';
import type { AgentSessionContinuationService } from '../../services/agent-session-continuation/agent-session-continuation.service';
import type {
  AgentSessionId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';

const ORG = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const PROJECT = '22222222-2222-4222-8222-222222222222' as ProjectId;
const SESSION = '33333333-3333-4333-8333-333333333333' as AgentSessionId;
const CONTINUATION = '44444444-4444-4444-8444-444444444444';
const OPERATION = '55555555-5555-4555-8555-555555555555';
const MACHINE = {
  machineId: '66666666-6666-4666-8666-666666666666' as MachineId,
  userId: '77777777-7777-4777-8777-777777777777' as UserId,
};

describe('machine continuation startup report boundary', () => {
  const recordStartup = jest
    .fn()
    .mockResolvedValue({ accepted: true, state: 'FAILED' });
  const controller = new MachineAgentSessionContinuationController({
    recordStartup,
  } as unknown as AgentSessionContinuationService);

  const send = (body: unknown) =>
    controller.reportStartup(
      ORG,
      PROJECT,
      SESSION,
      CONTINUATION,
      MACHINE,
      body,
    );

  beforeEach(() => recordStartup.mockClear());

  it('passes a report with its reason to the service under the authenticated machine', async () => {
    await send({
      deliveryOperationId: OPERATION,
      outcome: 'FAILED',
      reasonCode: 'PROVIDER_INVALID_CREDENTIAL',
    });
    expect(recordStartup).toHaveBeenCalledWith({
      organizationId: ORG,
      projectId: PROJECT,
      agentSessionId: SESSION,
      continuationId: CONTINUATION,
      machine: MACHINE,
      report: {
        deliveryOperationId: OPERATION,
        outcome: 'FAILED',
        reasonCode: 'PROVIDER_INVALID_CREDENTIAL',
      },
    });
  });

  // The spec requires a reason for FAILED and NATIVE_RESUME_REJECTED.
  it('rejects a failure report without its reason code', async () => {
    await expect(
      send({ deliveryOperationId: OPERATION, outcome: 'FAILED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recordStartup).not.toHaveBeenCalled();
  });
});
