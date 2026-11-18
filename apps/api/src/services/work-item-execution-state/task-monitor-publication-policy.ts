import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  WorkItemExecutionPublication,
  WorkItemExecutionPublicationDecision,
  WorkItemExecutionStateRegistry,
} from './work-item-execution-state.registry';

/**
 * Publication authority for Task Monitor execution state.
 *
 * A monitor runs on one computer. The platform's durable evidence of which
 * computer is the controller-admitted, machine-addressed monitor commands it
 * recorded (Start, Resume and the other authority-increasing commands carry
 * an admitted authorization). Exactly one addressed machine is the owner;
 * none means ownership is unavailable; several mean the history is ambiguous
 * and nobody may publish until it is resolved. Historical admission counts
 * after its execution grant expires, so a stopped or failed monitor stays
 * reportable. This decides reporting provenance only: it never admits a
 * command, selects a machine or transfers a monitor.
 */
export async function decideTaskMonitorPublication(
  { workItem, reportingMachineId }: WorkItemExecutionPublication,
  tx: Prisma.TransactionClient,
): Promise<WorkItemExecutionPublicationDecision> {
  // Two distinct machines are enough to know the history is ambiguous.
  const admitted = await tx.$queryRaw<Array<{ machineId: string }>>(
    Prisma.sql`
      SELECT DISTINCT machine_id AS "machineId"
      FROM monitor_commands
      WHERE monitor_id = ${workItem.id}
        AND organization_id = ${workItem.organizationId}
        AND project_id = ${workItem.projectId}
        AND authorization_id IS NOT NULL
      LIMIT 2
    `,
  );

  const [owner, other] = admitted;
  if (!owner) {
    return { authorized: false, code: 'OWNER_UNAVAILABLE' };
  }
  if (other) {
    return { authorized: false, code: 'OWNER_CONFLICT' };
  }
  if (owner.machineId !== reportingMachineId) {
    return { authorized: false, code: 'OWNER_MISMATCH' };
  }

  return { authorized: true };
}

/** Registers the Task Monitor policy with the shared registry at startup. */
@Injectable()
export class TaskMonitorPublicationPolicyRegistration implements OnModuleInit {
  constructor(private readonly registry: WorkItemExecutionStateRegistry) {}

  onModuleInit(): void {
    this.registry.registerPublicationPolicy(
      'TASK_MONITOR',
      decideTaskMonitorPublication,
    );
  }
}
