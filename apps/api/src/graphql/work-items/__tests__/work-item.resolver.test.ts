import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { TaskService } from '../../../services/tasks/task.service';
import type { GraphQLRequestContext } from '../../graphql-request-context';
import {
  EntityRefResolver,
  TrackedEntityResolver,
  WorkItemGraphReferenceResolver,
} from '../entity-ref.resolver';
import { WorkItemResolver } from '../work-item.resolver';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT = '99999999-9999-4999-8999-999999999999';
const ITEM = '33333333-3333-4333-8333-333333333333';
const PARENT = '44444444-4444-4444-8444-444444444444';
const SECOND = '55555555-5555-4555-8555-555555555555';
const LINKED = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'user-token';

const workItem = (extra: Record<string, unknown> = {}) => ({
  id: ITEM,
  name: 'Competitor profile',
  type: 'competitor',
  status: 'RESEARCHING',
  organizationId: ORG,
  projectId: PROJECT,
  parentTaskId: PARENT,
  source: 'USER',
  sections: [
    {
      id: 's1',
      key: 'positioning',
      order: 0,
      materializedMarkdown: 'Cheaper',
      materializedProposalId: 'p1',
    },
  ],
  ...extra,
});

describe('WorkItemResolver', () => {
  let app: INestApplication;

  const taskService = {
    findOneByOrganization: jest.fn(),
    findAll: jest.fn(),
    findAllByOrganizationForAdapter: jest.fn(),
    getGraphAggregates: jest.fn(),
    findHierarchyByOrganization: jest.fn(),
    findReferences: jest.fn(),
  };

  const query = async (body: string) => {
    const response = await request(app.getHttpServer())
      .post(`/o/${ORG}/p/${PROJECT}/graphql`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ query: body });

    return response.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          path: 'o/:organizationId/p/:projectId/graphql',
          autoSchemaFile: true,
          fieldResolverEnhancers: ['filters'],
          context: ({ req, res }: GraphQLRequestContext) => ({ req, res }),
        }),
      ],
      providers: [
        WorkItemResolver,
        EntityRefResolver,
        TrackedEntityResolver,
        WorkItemGraphReferenceResolver,
        { provide: TaskService, useValue: taskService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads a project-defined type with its open type key, status and sections', async () => {
    taskService.findOneByOrganization.mockResolvedValue(workItem());

    const body = await query(
      `{ workItem(id: "${ITEM}") { id type status sections { key order materializedMarkdown } } }`,
    );

    expect(body.data.workItem).toEqual({
      id: ITEM,
      type: 'competitor',
      status: 'RESEARCHING',
      sections: [
        { key: 'positioning', order: 0, materializedMarkdown: 'Cheaper' },
      ],
    });
    expect(taskService.findOneByOrganization).toHaveBeenCalledWith(
      ORG,
      ITEM,
      false,
      false,
      false,
      false,
      TOKEN,
    );
  });

  it('never returns a work item from another project', async () => {
    taskService.findOneByOrganization.mockResolvedValue(
      workItem({ projectId: OTHER_PROJECT }),
    );

    const body = await query(`{ workItem(id: "${ITEM}") { id } }`);

    expect(body.data).toBeNull();
    expect(body.errors[0].extensions.code).toBe('NOT_FOUND');
  });

  it('reads optional parts only when the query selects them', async () => {
    taskService.findAllByOrganizationForAdapter.mockResolvedValue([workItem()]);

    await query(`{ workItems { id name } }`);

    expect(taskService.findAllByOrganizationForAdapter).toHaveBeenCalledTimes(
      1,
    );
    expect(taskService.findAllByOrganizationForAdapter).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        includeEdges: false,
        includeTrackedEntities: false,
        includeDesignDocCounts: false,
      }),
    );
  });

  it('reads edges for every listed item in one batched read, with typed endpoints', async () => {
    const edge = {
      id: 'e1',
      type: 'DEPENDS_ON',
      sourceNodeId: ITEM,
      sourceEntityType: 'TASK',
      targetNodeId: LINKED,
      targetEntityType: 'TASK',
      targetNodeName: 'Linked',
      reasoning: 'needs it',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    taskService.findAllByOrganizationForAdapter
      .mockResolvedValueOnce([workItem(), workItem({ id: SECOND })])
      .mockResolvedValueOnce([
        workItem({ edges: [edge] }),
        workItem({ id: SECOND, edges: [] }),
      ])
      .mockResolvedValueOnce([workItem({ id: LINKED, name: 'Linked' })]);

    const body = await query(
      `{ workItems { id edges(types: [DEPENDS_ON]) { id type target { entityId name workItem { id name } } } } }`,
    );

    expect(body.data.workItems).toEqual([
      {
        id: ITEM,
        edges: [
          {
            id: 'e1',
            type: 'DEPENDS_ON',
            target: {
              entityId: LINKED,
              name: 'Linked',
              workItem: { id: LINKED, name: 'Linked' },
            },
          },
        ],
      },
      { id: SECOND, edges: [] },
    ]);
    const calls = taskService.findAllByOrganizationForAdapter.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1][1]).toMatchObject({
      projectId: PROJECT,
      taskIds: [ITEM, SECOND],
      includeEdges: true,
      edgeTypes: ['DEPENDS_ON'],
    });
    expect(calls[2][1]).toMatchObject({
      projectId: PROJECT,
      taskIds: [LINKED],
    });
  });

  it('resolves an endpoint outside the project as null', async () => {
    taskService.findOneByOrganization.mockResolvedValue(workItem());
    taskService.findAllByOrganizationForAdapter
      .mockResolvedValueOnce([
        workItem({
          edges: [
            {
              id: 'e1',
              type: 'RELATED_TO',
              sourceNodeId: ITEM,
              sourceEntityType: 'TASK',
              targetNodeId: LINKED,
              targetEntityType: 'TASK',
              reasoning: '',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([]);

    const body = await query(
      `{ workItem(id: "${ITEM}") { edges { target { workItem { id } } } } }`,
    );

    expect(body.data.workItem.edges).toEqual([{ target: { workItem: null } }]);
  });

  it('reads a list-view count for all rows at once', async () => {
    taskService.findAllByOrganizationForAdapter
      .mockResolvedValueOnce([workItem(), workItem({ id: SECOND })])
      .mockResolvedValueOnce([
        workItem({ designDocCount: 2 }),
        workItem({ id: SECOND, designDocCount: 0 }),
      ]);

    const body = await query(`{ workItems { id designDocCount } }`);

    expect(body.data.workItems).toEqual([
      { id: ITEM, designDocCount: 2 },
      { id: SECOND, designDocCount: 0 },
    ]);
    expect(
      taskService.findAllByOrganizationForAdapter.mock.calls[1][1],
    ).toMatchObject({ taskIds: [ITEM, SECOND], includeDesignDocCounts: true });
  });

  it('reads only the requested section keys', async () => {
    taskService.findAllByOrganizationForAdapter
      .mockResolvedValueOnce([workItem()])
      .mockResolvedValueOnce([workItem()]);

    await query(`{ workItems { sections(keys: ["positioning"]) { key } } }`);

    const [listCall, sectionsCall] =
      taskService.findAllByOrganizationForAdapter.mock.calls;
    expect(listCall[1].includeSectionKeys).toEqual([
      '__all_declared_sections__',
    ]);
    expect(sectionsCall).toBeUndefined();
  });

  it('passes the related-entity filter and sort to the list read', async () => {
    taskService.findAllByOrganizationForAdapter.mockResolvedValue([]);

    await query(
      `{ workItems(relatedTo: { entityId: "${LINKED}", entityType: TASK, edgeTypes: [DEPENDS_ON] }, sort: { field: title, direction: asc }) { id } }`,
    );

    expect(taskService.findAllByOrganizationForAdapter).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        relatedEntityId: LINKED,
        relatedEntityType: 'TASK',
        edgeTypes: ['DEPENDS_ON'],
        sortBy: 'title',
        sortDir: 'asc',
      }),
    );
  });

  it('lists project work items with the filters GET work-items accepts', async () => {
    taskService.findAllByOrganizationForAdapter.mockResolvedValue([workItem()]);

    const body = await query(
      `{ workItems(parentTaskIds: ["${PARENT}"], type: "competitor", statuses: ["RESEARCHING"], limit: 10) { id type } }`,
    );

    expect(body.data.workItems).toEqual([{ id: ITEM, type: 'competitor' }]);
    expect(taskService.findAllByOrganizationForAdapter).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        projectId: PROJECT,
        userToken: TOKEN,
        parentTaskIds: [PARENT],
        taskType: 'competitor',
        statuses: ['RESEARCHING'],
        limit: 10,
      }),
    );
  });

  it('drops empty and placeholder status values the same way REST does', async () => {
    taskService.findAllByOrganizationForAdapter.mockResolvedValue([]);

    await query(
      `{ workItems(statuses: ["", "null", "undefined", "false", "ACTIVE"]) { id } }`,
    );
    await query(`{ workItems(statuses: [""]) { id } }`);

    const [[, withActive], [, emptyOnly]] =
      taskService.findAllByOrganizationForAdapter.mock.calls;
    expect(withActive.statuses).toEqual(['ACTIVE']);
    expect(emptyOnly).not.toHaveProperty('statuses');
  });

  it('lists top-level items of an initiative when parentTaskId is null', async () => {
    taskService.findAll.mockResolvedValue([]);

    await query(
      `{ workItems(initiativeId: "${PARENT}", parentTaskId: null) { id } }`,
    );

    expect(taskService.findAll).toHaveBeenCalledWith(
      ORG,
      PARENT,
      expect.objectContaining({ projectId: PROJECT, parentTaskId: null }),
    );
  });

  it('rejects parentTaskId combined with parentTaskIds as REST does', async () => {
    const body = await query(
      `{ workItems(parentTaskId: "${PARENT}", parentTaskIds: ["${PARENT}"]) { id } }`,
    );

    expect(body.errors[0].extensions.code).toBe('BAD_REQUEST');
    expect(taskService.findAllByOrganizationForAdapter).not.toHaveBeenCalled();
  });

  it('serves relationship evidence from the REST graph aggregate', async () => {
    taskService.findOneByOrganization.mockResolvedValue(workItem());
    const aggregate = {
      root: workItem(),
      children: [],
      relationships: [
        {
          id: 'edge-1',
          type: 'DEPENDS_ON',
          sourceNodeId: ITEM,
          targetNodeId: LINKED,
          reasoning: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      layout: null,
      derivedReferences: [],
      participation: { entries: [], summary: {} },
    };
    taskService.getGraphAggregates.mockResolvedValue(
      new Map([[ITEM, aggregate]]),
    );

    const body = await query(
      `{ workItem(id: "${ITEM}") { graph(incidentRelationshipTypes: ["GUARANTEES"]) { root { id } relationships { id type target { entityId } } layout } } }`,
    );

    expect(body.data.workItem.graph).toEqual({
      root: { id: ITEM },
      relationships: [
        { id: 'edge-1', type: 'DEPENDS_ON', target: { entityId: LINKED } },
      ],
      layout: null,
    });
    expect(taskService.getGraphAggregates).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      [ITEM],
      TOKEN,
      ['GUARANTEES'],
    );
  });

  it('reads the graph of every listed item in one batched read', async () => {
    taskService.findAllByOrganizationForAdapter.mockResolvedValue([
      workItem(),
      workItem({ id: SECOND }),
    ]);
    const aggregateFor = (id: string) => ({
      root: workItem({ id }),
      children: [],
      relationships: [],
      layout: null,
      derivedReferences: [],
      participation: { entries: [], summary: {} },
    });
    taskService.getGraphAggregates.mockResolvedValue(
      new Map([
        [ITEM, aggregateFor(ITEM)],
        [SECOND, aggregateFor(SECOND)],
      ]),
    );

    const body = await query(`{ workItems { id graph { root { id } } } }`);

    expect(body.data.workItems).toEqual([
      { id: ITEM, graph: { root: { id: ITEM } } },
      { id: SECOND, graph: { root: { id: SECOND } } },
    ]);
    expect(taskService.getGraphAggregates).toHaveBeenCalledTimes(1);
    expect(taskService.getGraphAggregates).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      [ITEM, SECOND],
      TOKEN,
      [],
    );
  });

  it('reports a graph-aggregate failure under its REST code at the nested field', async () => {
    taskService.findOneByOrganization.mockResolvedValue(workItem());
    taskService.getGraphAggregates.mockResolvedValue(
      new Map([[ITEM, new NotFoundException('Work item not found')]]),
    );

    const body = await query(
      `{ workItem(id: "${ITEM}") { graph { layout } } }`,
    );

    expect(body.errors[0].extensions.code).toBe('NOT_FOUND');
    expect(body.errors[0].path).toEqual(['workItem', 'graph']);
  });

  describe('hierarchy', () => {
    it('serves the same hierarchy REST returns, as WorkItem records', async () => {
      taskService.findHierarchyByOrganization.mockResolvedValue({
        task: workItem({ designDocCount: 2 }),
        parent: workItem({ id: PARENT, name: 'Parent' }),
        children: [workItem({ id: SECOND, name: 'Child' })],
      });

      const body = await query(
        `{ workItemHierarchy(id: "${ITEM}", includeDesignDocCounts: true) { task { id designDocCount } parent { id name } children { id name type } } }`,
      );

      expect(body.data.workItemHierarchy).toEqual({
        task: { id: ITEM, designDocCount: 2 },
        parent: { id: PARENT, name: 'Parent' },
        children: [{ id: SECOND, name: 'Child', type: 'competitor' }],
      });
      expect(taskService.findHierarchyByOrganization).toHaveBeenCalledWith(
        ORG,
        ITEM,
        true,
        false,
        false,
      );
      // The counts came with the hierarchy read; no second read is made.
      expect(
        taskService.findAllByOrganizationForAdapter,
      ).not.toHaveBeenCalled();
    });

    it('answers a top-level task with no parent', async () => {
      taskService.findHierarchyByOrganization.mockResolvedValue({
        task: workItem({ parentTaskId: undefined }),
        children: [],
      });

      const body = await query(
        `{ workItemHierarchy(id: "${ITEM}") { parent { id } children { id } } }`,
      );

      expect(body.data.workItemHierarchy).toEqual({
        parent: null,
        children: [],
      });
    });

    it('never returns a hierarchy from another project', async () => {
      taskService.findHierarchyByOrganization.mockResolvedValue({
        task: workItem({ projectId: OTHER_PROJECT }),
        children: [],
      });

      const body = await query(
        `{ workItemHierarchy(id: "${ITEM}") { task { id } } }`,
      );

      expect(body.data).toBeNull();
      expect(body.errors[0].message).toBe('Task not found');
    });

    it('reports the REST not-found code for a missing task', async () => {
      taskService.findHierarchyByOrganization.mockRejectedValue(
        new NotFoundException('Task with ID x not found.'),
      );

      const body = await query(
        `{ workItemHierarchy(id: "${ITEM}") { task { id } } }`,
      );

      expect(body.errors[0].message).toBe('Task with ID x not found.');
    });
  });

  describe('references', () => {
    const page = {
      items: [
        {
          id: ITEM,
          name: 'Competitor',
          type: 'competitor',
          parentTaskId: null,
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      },
    };

    it('serves the page REST returns for the same input', async () => {
      taskService.findReferences.mockResolvedValue(page);

      const body = await query(
        `{ workItemReferences(type: " competitor ", page: 1, limit: 20, filter: " comp ", statuses: ["ACTIVE", "ACTIVE"], sortBy: "createdAt", sortOrder: "desc") { items { id name type parentTaskId } pagination { page limit total totalPages hasNext hasPrevious } } }`,
      );

      expect(body.data.workItemReferences).toEqual(page);
      expect(taskService.findReferences).toHaveBeenCalledWith(
        ORG,
        PROJECT,
        'competitor',
        1,
        20,
        'comp',
        ['ACTIVE'],
        'createdAt',
        'desc',
      );
    });

    it('lists every reference of a type by reading the pages REST serves', async () => {
      taskService.findReferences
        .mockResolvedValueOnce({
          items: [page.items[0]],
          pagination: { ...page.pagination, total: 2, hasNext: true },
        })
        .mockResolvedValueOnce({
          items: [{ ...page.items[0], id: SECOND }],
          pagination: { ...page.pagination, page: 2, total: 2 },
        });

      const body = await query(
        `{ allWorkItemReferences(type: "competitor") { id } }`,
      );

      expect(body.data.allWorkItemReferences).toEqual([
        { id: ITEM },
        { id: SECOND },
      ]);
      expect(taskService.findReferences).toHaveBeenNthCalledWith(
        2,
        ORG,
        PROJECT,
        'competitor',
        2,
        500,
      );
    });

    it('defaults sort to name ascending', async () => {
      taskService.findReferences.mockResolvedValue(page);

      await query(
        `{ workItemReferences(type: "competitor", page: 1, limit: 20) { items { id } } }`,
      );

      expect(taskService.findReferences).toHaveBeenCalledWith(
        ORG,
        PROJECT,
        'competitor',
        1,
        20,
        undefined,
        undefined,
        'name',
        'asc',
      );
    });

    it.each([
      ['a limit above 500', 'type: "competitor", page: 1, limit: 501'],
      ['a page below 1', 'type: "competitor", page: 0, limit: 20'],
      [
        'an unknown status',
        'type: "competitor", page: 1, limit: 20, statuses: ["NOPE"]',
      ],
      [
        'an unknown sort field',
        'type: "competitor", page: 1, limit: 20, sortBy: "x"',
      ],
      ['a blank type', 'type: "  ", page: 1, limit: 20'],
    ])('rejects %s as REST does', async (_name, args) => {
      const body = await query(
        `{ workItemReferences(${args}) { items { id } } }`,
      );

      expect(body.errors).toHaveLength(1);
      expect(body.data).toBeNull();
      expect(taskService.findReferences).not.toHaveBeenCalled();
    });
  });
});
