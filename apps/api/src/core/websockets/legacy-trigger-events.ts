import {
  SignedCliReadEnvelope,
  SignedConversationControlEnvelope,
  SignedConversationTriggerEnvelope,
  SignedMonitorCommandEnvelope,
} from '../../generated';

interface LegacyMachineEvent<TType extends string, TEnvelope> {
  type: TType;
  timestamp: string;
  organizationId: string;
  projectId?: string;
  conversationId?: string;
  userId?: string;
  envelope: TEnvelope;
}

// These internal types keep the pre-cutover emitters explicit while the
// controller-authorized dispatch integration is completed by its owning task.
// They are intentionally not exported from the public generated API contract.
export type LegacyWebSocketConversationTriggerEvent = LegacyMachineEvent<
  'trigger.conversation',
  SignedConversationTriggerEnvelope
>;
export type LegacyWebSocketMonitorCommandEvent = LegacyMachineEvent<
  'trigger.monitor_command',
  SignedMonitorCommandEnvelope
> & { projectId: string };
export type LegacyWebSocketConversationControlEvent = LegacyMachineEvent<
  'trigger.control',
  SignedConversationControlEnvelope
>;
export type LegacyWebSocketCliReadRequestEvent = LegacyMachineEvent<
  'cli.read.request',
  SignedCliReadEnvelope
>;
