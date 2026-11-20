import { forwardRef, Module } from '@nestjs/common';
import { EventRouterModule } from '../events/event-router.module';
import { ServerSigningModule } from '../server-signing/server-signing.module';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RealtimeBridge } from './websocket-bridge.service';
import { MachineChallengeService } from './machine-challenge.service';
import { TriggerEmitter } from './trigger-emitter.service';
import { TriggerEnvelopeSigner } from './trigger-envelope-signer.service';
import { TriggerRecipientResolver } from './trigger-recipient-resolver.service';
import { WebsocketConnectionManager } from './websocket-connection-manager.service';
import { WebsocketGateway } from './websocket.gateway';
import { MachinePresenceService } from './machine-presence.service';
import { WebsocketAuthorizationService } from './websocket-authorization.service';
import { WebsocketUserConnectionLifecycleService } from './websocket-user-connection-lifecycle.service';
import { BrowserSessionEvictionService } from './browser-session-eviction.service';
import { CliReadEmitter } from './cli-read-emitter.service';
import { CliSettingsEmitter } from './cli-settings-emitter.service';
import { OrganizationConnectionEvictionService } from './organization-connection-eviction.service';
import { MachineConnectionEvictionService } from './machine-connection-eviction.service';
import { ExecutableFrameAuthorizationService } from './executable-frame-authorization.service';
import { AgentOperationDispatchService } from './agent-operation-dispatch.service';
import { DemoSandboxActivityModule } from '../../services/demo-sandbox/demo-sandbox-activity.module';
import { WorkflowModule } from '../../services/workflows/workflow.module';
import { WorkItemExecutionStateRegistry } from '../../services/work-item-execution-state/work-item-execution-state.registry';
import { WorkItemExecutionStateService } from '../../services/work-item-execution-state/work-item-execution-state.service';
import { WorkItemExecutionStateDelivery } from '../../services/work-item-execution-state/work-item-execution-state.delivery';
import { TaskMonitorPublicationPolicyRegistration } from '../../services/work-item-execution-state/task-monitor-publication-policy';

@Module({
  imports: [
    EventRouterModule,
    AuthModule,
    PrismaModule,
    ServerSigningModule,
    DemoSandboxActivityModule,
    forwardRef(() => WorkflowModule),
  ],
  providers: [
    WebsocketConnectionManager,
    RealtimeBridge,
    WebsocketGateway,
    MachineChallengeService,
    TriggerEnvelopeSigner,
    TriggerRecipientResolver,
    TriggerEmitter,
    MachinePresenceService,
    WebsocketAuthorizationService,
    WebsocketUserConnectionLifecycleService,
    BrowserSessionEvictionService,
    CliReadEmitter,
    CliSettingsEmitter,
    OrganizationConnectionEvictionService,
    MachineConnectionEvictionService,
    ExecutableFrameAuthorizationService,
    AgentOperationDispatchService,
    WorkItemExecutionStateRegistry,
    WorkItemExecutionStateDelivery,
    WorkItemExecutionStateService,
    TaskMonitorPublicationPolicyRegistration,
  ],
  exports: [
    WebsocketConnectionManager,
    RealtimeBridge,
    WebsocketGateway,
    MachineChallengeService,
    TriggerEnvelopeSigner,
    TriggerEmitter,
    EventRouterModule,
    MachinePresenceService,
    WebsocketAuthorizationService,
    WebsocketUserConnectionLifecycleService,
    BrowserSessionEvictionService,
    CliReadEmitter,
    CliSettingsEmitter,
    OrganizationConnectionEvictionService,
    MachineConnectionEvictionService,
    ExecutableFrameAuthorizationService,
    AgentOperationDispatchService,
    WorkItemExecutionStateRegistry,
    WorkItemExecutionStateService,
  ],
})
export class WebsocketsModule {}
