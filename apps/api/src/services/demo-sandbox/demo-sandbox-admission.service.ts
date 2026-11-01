import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DemoSandbox,
  DemoSandboxProgramState,
  DemoSandboxStage,
  DemoSandboxStatus,
  OrganizationMember,
  OrganizationRole,
  Prisma,
  ProjectRole,
} from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  DemoSandboxAdmissionDto,
  DemoSandboxAdmissionState,
  DemoSandboxResponseDto,
  DemoSandboxSetupStage,
  DemoSandboxUnavailableCode,
  DemoSandboxResumeState,
  ProvisionDemoSandboxDto,
} from '../../generated';
import {
  BrowserSessionPrincipal,
  BrowserSessionService,
  EstablishedBrowserSession,
} from '../../auth/services/browser-session.service';
import { BrowserSessionRequestMetadata } from '../../auth/browser-session.types';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { AccountEntitlementService } from '../account-entitlement.service';
import { OrganizationService } from '../organization.service';
import { ProjectService } from '../project.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import type { OrganizationId, ProjectId, UserId } from '../../types';
import { BotCheckService } from './bot-check.service';
import { DemoSandboxDiscardService } from './demo-sandbox-discard.service';
import { DemoSandboxReadinessService } from './demo-sandbox-readiness.service';
import { isDemoSandboxEnabled } from './demo-sandbox-program.service';
import { ProjectTemplateCloneService } from './project-template-clone.service';
import {
  DEFAULT_PROVISIONING_DEADLINE_SECONDS,
  DEMO_AGENT_BRIDGE_DOCUMENT,
  DEMO_SYSTEM_USER_ID,
  DEMO_TERMS_DOCUMENT,
  PROGRAM_STATE_ID,
  resolveInactivityTimeoutSeconds,
  UNUSABLE_PASSWORD_HASH,
} from './demo-sandbox.constants';

export interface DemoSandboxRequestContext {
  /** Raw value of the browser-binding cookie, when the browser sent one. */
  bindingSecret?: string;
  ipAddress?: string;
  sessionMetadata: BrowserSessionRequestMetadata;
}

export interface DemoSandboxAdmission {
  admission: DemoSandboxAdmissionDto;
  /** Present only for an ACTIVE sandbox; the caller is signed in to it. */
  session?: EstablishedBrowserSession;
  /** Present only for a newly reserved sandbox; published as the binding cookie. */
  bindingSecret?: string;
}

const SETUP_STAGE: Record<DemoSandboxStage, DemoSandboxSetupStage> = {
  [DemoSandboxStage.COPYING]: DemoSandboxSetupStage.Copying,
  [DemoSandboxStage.CONNECTING]: DemoSandboxSetupStage.Connecting,
  [DemoSandboxStage.READY]: DemoSandboxSetupStage.Ready,
  // A FAILED attempt has already left PROVISIONING; never reported as progress.
  [DemoSandboxStage.FAILED]: DemoSandboxSetupStage.Connecting,
};

const ADMISSION_LOCK = 'demo-sandbox-admission';
const PREPARE_TRANSACTION_TIMEOUT_MILLISECONDS = 60_000;
const hashBindingSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

@Injectable()
export class DemoSandboxAdmissionService {
  private readonly logger = new Logger(DemoSandboxAdmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly botCheck: BotCheckService,
    private readonly organizations: OrganizationService,
    private readonly projects: ProjectService,
    private readonly entitlements: AccountEntitlementService,
    private readonly clone: ProjectTemplateCloneService,
    private readonly readiness: DemoSandboxReadinessService,
    private readonly discard: DemoSandboxDiscardService,
    private readonly browserSessions: BrowserSessionService,
    private readonly workItemTypes: WorkItemTypeRegistryService,
  ) {}

  /**
   * POST /demo-sandboxes. Returns once the PROVISIONING row is reserved; the
   * slow setup continues in the background and is read through resume.
   */
  async provision(
    input: ProvisionDemoSandboxDto,
    context: DemoSandboxRequestContext,
  ): Promise<DemoSandboxAdmission> {
    const bound = await this.lookupBound(context);
    // A FAILED binding starts over; Try again replaces it with a new one.
    if (
      typeof bound === 'object' &&
      bound.admission.state !== DemoSandboxAdmissionState.Failed
    ) {
      return bound;
    }

    const creatorIpHash = this.hashIp(context.ipAddress);
    await this.assertAdmissible(this.prisma.db, creatorIpHash, new Date());
    if (!(await this.botCheck.verify(input.botCheckToken, context.ipAddress))) {
      throw this.refusal(
        HttpStatus.BAD_REQUEST,
        DemoSandboxUnavailableCode.BotCheckFailed,
        'Bot check failed',
      );
    }
    if (
      input.demoTermsVersion !== DEMO_TERMS_DOCUMENT.version ||
      input.agentBridgeAcknowledgmentVersion !==
        DEMO_AGENT_BRIDGE_DOCUMENT.version
    ) {
      throw new ConflictException(
        'The demo terms changed. Refresh them before continuing.',
      );
    }

    const bindingSecret = randomBytes(32).toString('base64url');
    const reservationId = await this.reserve(creatorIpHash, bindingSecret);
    void this.completeInBackground(reservationId);
    return {
      admission: {
        state: DemoSandboxAdmissionState.Provisioning,
        progress: {
          stage: DemoSandboxSetupStage.Copying,
          connectedFeatureCount: 0,
          totalFeatureCount: 0,
        },
      },
      bindingSecret,
    };
  }

  /**
   * Prepare, wait for every copied feature, then activate. No request waits
   * on this, so it never throws; a restart abandons it and the deadline sweep
   * discards the row without extending the deadline.
   */
  private async completeInBackground(sandboxId: string): Promise<void> {
    try {
      const organizationId = await this.prepare(sandboxId);
      await this.refreshWorkItemTypes(organizationId);
      if (
        (await this.readiness.waitUntilConnected(sandboxId)) &&
        (await this.activate(sandboxId))
      ) {
        return;
      }
    } catch (error) {
      this.logger.error('Demo sandbox setup failed', {
        sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await this.discardQuietly(sandboxId);
  }

  private async discardQuietly(sandboxId: string): Promise<void> {
    try {
      await this.discard.discard(sandboxId);
    } catch (error) {
      // The deadline sweep retries the discard; resume reports it then.
      this.logger.error('Demo sandbox discard failed; sweep will retry', {
        sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** POST /demo-sandboxes/resume */
  async resume(
    context: DemoSandboxRequestContext,
  ): Promise<DemoSandboxAdmission> {
    const bound = await this.lookupBound(context);
    if (typeof bound === 'object') return bound;
    throw new NotFoundException({
      message: 'No unexpired demo sandbox for this browser',
      data: { state: bound },
    });
  }

  /** GET /demo-sandboxes/current */
  async current(userId: UserId): Promise<DemoSandboxResponseDto> {
    const sandbox = await this.prisma.db.demoSandbox.findFirst({
      where: {
        demoUserId: userId,
        status: DemoSandboxStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });
    if (!sandbox) throw new NotFoundException('Not a demo user');
    return this.toResponse(this.prisma.db, sandbox, false);
  }

  /**
   * Shared by provision and resume: what the sandbox bound to this browser
   * shows it. Only an ACTIVE, unexpired sandbox issues a session; setup in
   * progress exposes only its stage and feature counts.
   */
  private async lookupBound(
    context: DemoSandboxRequestContext,
  ): Promise<DemoSandboxAdmission | DemoSandboxResumeState> {
    if (!context.bindingSecret) return DemoSandboxResumeState.None;
    const bindingHash = hashBindingSecret(context.bindingSecret);
    return this.prisma.$transaction(async (tx) => {
      const sandbox = await tx.demoSandbox.findUnique({
        where: { browserBindingHash: bindingHash },
      });
      if (!sandbox) return DemoSandboxResumeState.None;
      if (
        sandbox.status === DemoSandboxStatus.ACTIVE &&
        sandbox.expiresAt &&
        sandbox.expiresAt > new Date() &&
        sandbox.demoUserId
      ) {
        const session = await this.browserSessions.establishInTransaction(
          tx,
          await this.principalFor(tx, sandbox.demoUserId),
          context.sessionMetadata,
        );
        return {
          admission: {
            state: DemoSandboxAdmissionState.Active,
            sandbox: await this.toResponse(tx, sandbox, true),
          },
          session,
        };
      }
      if (sandbox.status === DemoSandboxStatus.PROVISIONING) {
        return {
          admission: {
            state: DemoSandboxAdmissionState.Provisioning,
            progress: {
              stage: SETUP_STAGE[sandbox.stage],
              connectedFeatureCount: sandbox.connectedFeatureCount,
              totalFeatureCount: sandbox.readinessFeatureIds.length,
            },
          },
        };
      }
      if (sandbox.stage === DemoSandboxStage.FAILED) {
        return { admission: { state: DemoSandboxAdmissionState.Failed } };
      }
      return DemoSandboxResumeState.Expired;
    });
  }

  /** The deployment value, capacity and per-address checks of admission, in order. */
  private async assertAdmissible(
    client: AnyTransactionClient,
    creatorIpHash: string,
    now: Date,
  ): Promise<void> {
    if (!isDemoSandboxEnabled()) {
      throw this.refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        DemoSandboxUnavailableCode.Disabled,
        'Demo sandboxes are not available in this deployment',
      );
    }
    const program = await client.demoSandboxProgramState.findUniqueOrThrow({
      where: { id: PROGRAM_STATE_ID },
    });
    const occupied = await client.demoSandbox.count({
      where: {
        status: {
          in: [DemoSandboxStatus.ACTIVE, DemoSandboxStatus.PROVISIONING],
        },
      },
    });
    if (occupied >= program.activeCap) {
      throw this.refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        DemoSandboxUnavailableCode.AtCapacity,
        'Demo sandboxes are at capacity',
      );
    }
    const recent = await client.demoSandbox.count({
      where: {
        creatorIpHash,
        createdAt: { gt: this.windowStart(program, now) },
        // A failed setup never became a sandbox, so it does not use up a slot.
        stage: { not: DemoSandboxStage.FAILED },
      },
    });
    if (recent >= program.perIpLimit) {
      throw this.refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        DemoSandboxUnavailableCode.RateLimited,
        'Too many demo sandboxes from this address',
      );
    }
  }

  /**
   * The only serialized step of admission. Commits a PROVISIONING row that
   * counts toward the cap and the per-address limit, so the next visitor
   * through the lock sees it, then releases the lock before any preparation.
   */
  private async reserve(
    creatorIpHash: string,
    bindingSecret: string,
  ): Promise<string> {
    const reservation = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent admissions so the cap and per-address limit hold.
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${ADMISSION_LOCK}))::text`,
      );
      const now = new Date();
      await this.assertAdmissible(tx, creatorIpHash, now);
      return tx.demoSandbox.create({
        data: {
          browserBindingHash: hashBindingSecret(bindingSecret),
          creatorIpHash,
          provisioningDeadline: new Date(
            now.getTime() + DEFAULT_PROVISIONING_DEADLINE_SECONDS * 1000,
          ),
          status: DemoSandboxStatus.PROVISIONING,
          stage: DemoSandboxStage.COPYING,
        },
        select: { id: true },
      });
    });
    return reservation.id;
  }

  /**
   * Builds the whole sandbox in one transaction of its own, inaccessible: no
   * visitor membership and no session. The reservation row gains its tenancy,
   * the copied feature IDs and the CONNECTING stage only if it is still
   * PROVISIONING, so a discard that won the race rolls the whole preparation
   * back. Returns the new organization.
   */
  private async prepare(reservationId: string): Promise<string> {
    try {
      const templateSnapshot = await this.clone.snapshotTemplate(
        this.prisma.db,
      );
      return await this.prisma.$transaction(
        async (tx) => {
          const suffix = randomUUID();
          const organization =
            await this.organizations.createOrganizationWithTransaction(
              tx as unknown as Parameters<
                OrganizationService['createOrganizationWithTransaction']
              >[0],
              { name: `Demo sandbox ${suffix}` },
              DEMO_SYSTEM_USER_ID as UserId,
            );
          await this.entitlements.createBetaAtAdmissionInTransaction(
            tx,
            organization.id as OrganizationId,
            { actor: 'demo-sandbox', reason: 'Demo sandbox admission' },
          );
          const project = await this.projects.createSandboxProjectInTransaction(
            tx,
            {
              organizationId: organization.id as OrganizationId,
              name: 'Demo project',
              ownerUserId: DEMO_SYSTEM_USER_ID as UserId,
            },
          );
          const demoUser = await tx.user.create({
            data: {
              email: `demo-${suffix}@demo.invalid`,
              name: 'Demo visitor',
              passwordHash: UNUSABLE_PASSWORD_HASH,
              isDemoUser: true,
            },
          });

          const { copiedFeatureIds: readinessFeatureIds } =
            await this.clone.cloneInto(tx, {
              targetOrganizationId: organization.id,
              targetProjectId: project.id,
              templateSnapshot,
            });
          // Every copied feature must reach the graph before activation.
          if (readinessFeatureIds.length === 0) {
            throw new Error('Clone copied no template features');
          }

          for (const document of [
            DEMO_TERMS_DOCUMENT,
            DEMO_AGENT_BRIDGE_DOCUMENT,
          ]) {
            await tx.privateBetaDisclosureAcceptance.create({
              data: {
                userId: demoUser.id,
                organizationId: organization.id,
                documentKind: document.documentKind,
                version: document.version,
                effectiveDate: new Date(
                  `${document.effectiveDate}T00:00:00.000Z`,
                ),
                actionType: document.actionType,
              },
            });
          }

          const claimed = await tx.demoSandbox.updateMany({
            where: {
              id: reservationId,
              status: DemoSandboxStatus.PROVISIONING,
            },
            data: {
              organizationId: organization.id,
              projectId: project.id,
              demoUserId: demoUser.id,
              readinessFeatureIds,
              stage: DemoSandboxStage.CONNECTING,
            },
          });
          if (claimed.count !== 1) {
            throw new Error('Demo sandbox reservation was discarded');
          }
          return organization.id;
          // The clone copies every template row one at a time; the 5s default
          // would roll back any non-trivial template.
        },
        { timeout: PREPARE_TRANSACTION_TIMEOUT_MILLISECONDS },
      );
    } catch (error) {
      this.logger.error('Demo sandbox preparation rolled back', {
        sandboxId: reservationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Makes the attempt accessible, but only if it is still PROVISIONING, before
   * its deadline, and not closed. Returns false when closure won. No session
   * is issued here: the browser's next resume signs it in.
   */
  private async activate(sandboxId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          organizationId: string;
          projectId: string;
          demoUserId: string;
        }>
      >(Prisma.sql`
        SELECT organization_id AS "organizationId", project_id AS "projectId",
          demo_user_id AS "demoUserId"
        FROM demo_sandboxes
        WHERE id = ${sandboxId}
          AND status = 'PROVISIONING'::demo_sandbox_status
          AND provisioning_deadline > ${new Date()}
          AND organization_id IS NOT NULL
          AND demo_user_id IS NOT NULL
        FOR UPDATE
      `);
      const attempt = locked[0];
      if (!attempt) return false;

      const now = new Date();
      await tx.organizationMember.create({
        data: {
          userId: attempt.demoUserId,
          organizationId: attempt.organizationId,
          role: OrganizationRole.MEMBER,
          isActive: true,
          joinedAt: now,
        },
      });
      await this.projects.createProjectMembership(
        attempt.organizationId as OrganizationId,
        attempt.projectId as ProjectId,
        { userId: attempt.demoUserId as UserId, role: ProjectRole.MEMBER },
        tx,
      );
      await tx.demoSandbox.update({
        where: { id: sandboxId },
        data: {
          status: DemoSandboxStatus.ACTIVE,
          stage: DemoSandboxStage.READY,
          lastActivityAt: now,
          expiresAt: new Date(
            now.getTime() + resolveInactivityTimeoutSeconds(this.config) * 1000,
          ),
        },
      });
      return true;
    });
  }

  private async principalFor(
    tx: AnyTransactionClient,
    userId: string,
  ): Promise<BrowserSessionPrincipal> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { where: { isActive: true } } },
    });
    return {
      userId: user.id as UserId,
      user: {
        id: user.id as UserId,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        currentOrganizationId: null,
      },
      claims: {
        email: user.email,
        name: user.name,
        orgMemberships: user.memberships.map(
          (membership: OrganizationMember) => ({
            orgId: membership.organizationId as OrganizationId,
            role: membership.role,
          }),
        ),
        isDevAdmin: user.isDevAdmin,
        devAdminMode: user.devAdminMode,
      },
    };
  }

  private async toResponse(
    client: AnyTransactionClient,
    sandbox: DemoSandbox,
    resumed: boolean,
  ): Promise<DemoSandboxResponseDto> {
    const template = await client.demoTemplate.findFirstOrThrow({
      where: { active: true },
    });
    return {
      organizationId: sandbox.organizationId!,
      projectId: sandbox.projectId!,
      expiresAt: sandbox.expiresAt!.toISOString(),
      inactivityTimeoutSeconds: resolveInactivityTimeoutSeconds(this.config),
      repositoryUrl: template.repositoryUrl,
      resumed,
    };
  }

  private async refreshWorkItemTypes(organizationId: string): Promise<void> {
    // The cloned project-owned types commit with the attempt; instances must
    // reload them before the visitor can use the project.
    await this.workItemTypes.refresh();
    await this.workItemTypes.publishConfigChanged(
      organizationId as OrganizationId,
      'ALL',
    );
  }

  private windowStart(program: DemoSandboxProgramState, now: Date): Date {
    return new Date(now.getTime() - program.perIpWindowSeconds * 1000);
  }

  private hashIp(ipAddress: string | undefined): string {
    if (!ipAddress) throw new Error('Client address is unavailable');
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('DEMO_IP_HASH_KEY'),
    )
      .update(ipAddress)
      .digest('hex');
  }

  private refusal(
    status: HttpStatus,
    code: DemoSandboxUnavailableCode,
    message: string,
  ): HttpException {
    if (status === HttpStatus.BAD_REQUEST) {
      return new BadRequestException({ message, code });
    }
    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      return new ServiceUnavailableException({ message, code });
    }
    return new HttpException({ message, code }, status);
  }
}
