import { randomUUID } from 'node:crypto';
import type { WorkItemTypeDefinitionDto } from '@hey-hey/contracts/api/models';
import type { CreateProposalRequestDto } from '@hey-hey/contracts/api/models';
import {
  startInMemoryPostgres,
  type InMemoryPostgres,
} from '../../__tests__/helpers/in-memory-postgres';
import { PrismaService } from '../../prisma/prisma.service';
import { ProposalValidationEngine } from '../../services/proposal/proposal-validation.engine';
import { WorkItemParentageValidator } from '../../services/tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import type { OrganizationId, ProjectId, UserId } from '../../types';
import {
  editWorkItemTypeParameters,
  WorkItemTypeProposalToolsProvider,
} from '../tools/work-item-type-proposal-tools.provider';
import {
  getWorkItemTypeOutput,
  WorkItemTypeToolsProvider,
} from '../tools/work-item-type-tools.provider';

// The agent's read-modify-submit path over every canonical type the shipped
// Flyway migrations publish: the real tool schemas, proposal validation and
// registry persistence against a real PostgreSQL engine.
jest.setTimeout(180_000);

describe('agent work-item type edits keep every setting', () => {
  let database: InMemoryPostgres;
  let prisma: PrismaService;
  let registry: WorkItemTypeRegistryService;
  let engine: ProposalValidationEngine;
  const previousUrl = process.env.PROJECT_DATABASE_URL;
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  const userId = randomUUID() as UserId;
  const user = { userId, currentOrgId: organizationId };
  const request = {
    headers: { authorization: 'Bearer token', 'x-project-id': projectId },
    cookies: {},
    user,
  } as never;

  beforeAll(async () => {
    database = await startInMemoryPostgres();
    process.env.PROJECT_DATABASE_URL = database.url;
    prisma = new PrismaService();
    await prisma.$connect();

    await prisma.organization.create({
      data: { id: organizationId, name: 'Types', slug: organizationId },
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Author',
        email: `${userId}@example.test`,
        passwordHash: 'unused-test-hash',
        memberships: { create: { organizationId, role: 'ADMIN' } },
      },
    });
    await prisma.project.create({
      data: { id: projectId, name: 'Types', organizationId },
    });
    await prisma.projectMember.create({ data: { projectId, userId } });

    registry = new WorkItemTypeRegistryService(prisma, {
      subscribe: async () => undefined,
      publish: async () => undefined,
    } as never);
    await registry.refresh();
    engine = new ProposalValidationEngine(
      prisma,
      registry,
      new WorkItemParentageValidator(registry),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.close();
    process.env.PROJECT_DATABASE_URL = previousUrl;
  });

  /** What get_work_item_type puts on the wire. */
  async function readDefinition(
    typeKey: string,
  ): Promise<WorkItemTypeDefinitionDto> {
    const tools = new WorkItemTypeToolsProvider(registry, {
      findOne: async () => ({ id: projectId }),
    } as never);
    const summary = await tools.getWorkItemType(
      { typeKey },
      {} as never,
      request,
    );

    const output = getWorkItemTypeOutput.safeParse(summary);
    expect({ typeKey, issues: output.error?.issues }).toEqual({ typeKey });

    const wire: { definition: WorkItemTypeDefinitionDto } = JSON.parse(
      JSON.stringify(summary),
    );
    return wire.definition;
  }

  /** Submits through edit_work_item_type, as the MCP server calls it. */
  async function submitEdit(definition: WorkItemTypeDefinitionDto) {
    const params = editWorkItemTypeParameters.safeParse({
      typeKey: definition.key,
      definition,
      acknowledgeCanonicalCustomization: true,
    });
    expect({ typeKey: definition.key, issues: params.error?.issues }).toEqual({
      typeKey: definition.key,
    });

    let submitted: CreateProposalRequestDto | undefined;
    const proposals = {
      create: async (
        _organizationId: string,
        _projectId: string,
        _userId: string,
        dto: CreateProposalRequestDto,
      ) => {
        submitted = dto;
        const result = await engine.validate({
          proposals: [dto],
          context: { organizationId, projectId, requestor: user as never },
        });
        const blocking = result.proposals[0]!.errors.filter(
          (issue) => issue.layer !== 'permission',
        );
        expect({ typeKey: definition.key, blocking }).toEqual({
          typeKey: definition.key,
          blocking: [],
        });
        return { ...dto, id: randomUUID() };
      },
    };
    const tools = new WorkItemTypeProposalToolsProvider(
      proposals as never,
      { isPlatformAdmin: () => true } as never,
      registry,
    );

    const response = await tools.editWorkItemType(
      params.data!,
      {} as never,
      request,
    );

    expect(response).not.toHaveProperty('isError');
    return (submitted!.updates as { definition: WorkItemTypeDefinitionDto })
      .definition;
  }

  it('proposes and applies a guidance-only change to every shipped type with all other settings intact', async () => {
    const typeKeys = registry
      .getDefinitions(projectId)
      .map(({ definition }) => definition.key);
    const shipped = new Map<string, WorkItemTypeDefinitionDto>();

    for (const typeKey of typeKeys) {
      const current = await readDefinition(typeKey);
      shipped.set(typeKey, current);
      const changed = { ...current, maintenanceGuidance: 'One added line.' };

      const proposed = await submitEdit(changed);
      expect(proposed).toEqual(changed);

      await prisma.$transaction((tx) =>
        registry.updateAcceptedDefinitionInTransaction(
          tx,
          typeKey,
          proposed,
          projectId,
          organizationId,
        ),
      );
      await registry.refresh(projectId);
      expect(await readDefinition(typeKey)).toEqual(changed);
    }

    // The settings agents used to lose or be refused are really in this data.
    expect(
      shipped.get('DIAGRAM')?.capabilities?.graph?.readExpansions?.length,
    ).toBeGreaterThan(0);
    expect(
      shipped.get('TASK_MONITOR')?.capabilities?.monitorKinds?.length,
    ).toBeGreaterThan(0);
    expect(
      shipped
        .get('DIAGRAM_ELEMENT')
        ?.sections.some((section) => section.diagramElementPolicy),
    ).toBe(true);
  });

  it('accepts a graph type that declares no preferred shape', async () => {
    const diagram = await readDefinition('DIAGRAM');
    const { layoutPreference: _omitted, ...graph } =
      diagram.capabilities!.graph!;
    const withoutPreference = {
      ...diagram,
      capabilities: { ...diagram.capabilities, graph },
    };

    expect(await submitEdit(withoutPreference)).toEqual(withoutPreference);
  });

  it('refuses an unknown setting by name instead of dropping it', async () => {
    const diagram = await readDefinition('DIAGRAM');
    const [first, ...rest] = diagram.sections;

    const params = editWorkItemTypeParameters.safeParse({
      typeKey: diagram.key,
      definition: {
        ...diagram,
        sections: [{ ...first, unknownSectionSetting: true }, ...rest],
        capabilities: { ...diagram.capabilities, unknownCapability: true },
      },
    });

    const refusal = JSON.stringify(params.error?.issues);
    expect(refusal).toContain('unknownSectionSetting');
    expect(refusal).toContain('unknownCapability');
  });
});
