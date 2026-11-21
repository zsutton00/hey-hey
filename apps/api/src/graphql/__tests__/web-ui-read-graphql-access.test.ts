import {
  Controller,
  ForbiddenException,
  Get,
  Global,
  Param,
  INestApplication,
  Injectable,
  Module,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import {
  Args,
  Context,
  Field,
  ObjectType,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { runAsViewer } from '../run-as-viewer';
import type { GraphQLRequestContext } from '../graphql-request-context';
import { ThrottlerModule } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as request from 'supertest';
import { FlexibleAuthGuard } from '../../auth/guards/flexible-auth.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { ScopePathParamsGuard } from '../../auth/guards/scope-path-params.guard';
import { ProjectAccessService } from '../../auth/services/project-access.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { EventContextInterceptor } from '../../common/interceptors/event-context.interceptor';
import { EventContextManager } from '../../core/events/observable-event.context';
import { PrismaExceptionFilter } from '../../prisma-exception.filter';
import { ApiKeyThrottlerGuard } from '../../auth/guards/api-key-throttler.guard';
import { UseRestErrorCodes } from '../use-rest-error-codes.decorator';
import { WebUiReadGraphqlModule } from '../web-ui-read-graphql.module';

const SECRET = 'web-ui-read-graphql-access-test';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333333';
const MEMBER = 'member-user';
const OUTSIDER = 'outsider-user';
const SECOND_MEMBER = 'second-member-user';
const THIRD_MEMBER = 'third-member-user';
const MEMBERS = new Set([MEMBER, SECOND_MEMBER, THIRD_MEMBER]);

const token = (userId: string) => jwt.sign({ sub: userId }, SECRET);

const jwtOptions = {
  secretOrKey: SECRET,
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
};

@Injectable()
class StubJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super(jwtOptions);
  }

  validate(payload: { sub: string }) {
    return { userId: payload.sub };
  }
}

@Injectable()
class StubApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor() {
    super({
      secretOrKey: SECRET,
      jwtFromRequest: ExtractJwt.fromHeader('x-api-key'),
    });
  }

  validate(payload: { sub: string }) {
    return { userId: payload.sub, authType: 'api-key', organizationId: ORG };
  }
}

/** Membership is the only persistence the access guards consult. */
class StubProjectAccessService {
  async assertOrganization(userId: string, organizationId: string) {
    if (!MEMBERS.has(userId) || organizationId !== ORG) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }

  async assertProject(
    userId: string,
    organizationId: string,
    projectId: string,
  ) {
    if (
      !MEMBERS.has(userId) ||
      organizationId !== ORG ||
      projectId !== PROJECT
    ) {
      throw new ForbiddenException('Access denied to this project');
    }
  }
}

const failures = {
  prisma: () =>
    new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  stableCode: () =>
    new ForbiddenException({ message: 'no', code: 'PROJECT_ACCESS_DENIED' }),
} as const;

type FailureKind = keyof typeof failures;

/** The REST read the GraphQL endpoint must answer the same way as. */
@Controller('api/v1/organizations/:organizationId/projects/:projectId/rest')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
class RestReadController {
  @Get()
  read() {
    return { ok: true };
  }

  @Get('fail/:kind')
  fail(@Param('kind') kind: FailureKind): never {
    throw failures[kind]();
  }
}

/**
 * A resolver added later with no access decorator at all. It must still be
 * protected, because access is enforced for every resolver by default.
 */
@Resolver()
class UndecoratedResolver {
  @Query(() => String)
  undecorated(): string {
    return 'secret';
  }
}

@ObjectType()
class ViewerProbe {
  @Field(() => String)
  rootViewer!: string;

  @Field(() => String)
  bareNestedViewer!: string;

  @Field(() => String)
  nestedViewer!: string;
}

const currentViewer = () =>
  String(EventContextManager.getInstance().getCurrentContext()?.userId);

@Resolver(() => ViewerProbe)
class ViewerProbeResolver {
  @Query(() => ViewerProbe)
  viewerProbe(): Partial<ViewerProbe> {
    return { rootViewer: currentViewer() };
  }

  @ResolveField(() => String)
  async bareNestedViewer(): Promise<string> {
    await Promise.resolve();

    return currentViewer();
  }

  @ResolveField(() => String)
  nestedViewer(@Context() context: GraphQLRequestContext): Promise<string> {
    return runAsViewer(context, async () => currentViewer());
  }
}

/** Reads what the interceptors established around a root query field. */
@Resolver()
@UseRestErrorCodes()
class ProbeResolver {
  @Query(() => String)
  eventScope(): string {
    const { organizationId, projectId, userId } =
      EventContextManager.getInstance().getCurrentContext() ?? {};

    return [organizationId, projectId, userId].join('|');
  }

  @Query(() => String)
  fail(@Args('kind') kind: string): never {
    throw failures[kind as FailureKind]();
  }
}

/** Stands in for the global ProjectAccessModule, minus Prisma and Redis. */
@Global()
@Module({
  providers: [
    { provide: ProjectAccessService, useClass: StubProjectAccessService },
    ProjectAccessGuard,
  ],
  exports: [ProjectAccessService, ProjectAccessGuard],
})
class StubProjectAccessModule {}

@Module({
  imports: [PassportModule, StubProjectAccessModule, WebUiReadGraphqlModule],
  controllers: [RestReadController],
  providers: [
    StubJwtStrategy,
    StubApiKeyStrategy,
    UndecoratedResolver,
    ProbeResolver,
    ViewerProbeResolver,
    { provide: APP_INTERCEPTOR, useClass: EventContextInterceptor },
    { provide: APP_GUARD, useClass: FlexibleAuthGuard },
    { provide: APP_GUARD, useClass: ScopePathParamsGuard },
  ],
})
class AccessTestModule {}

describe('read-only GraphQL endpoint access', () => {
  let app: INestApplication;

  const graphqlPath = (organizationId = ORG, projectId = PROJECT) =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}/graphql`;
  const restPath = (organizationId = ORG, projectId = PROJECT) =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}/rest`;

  const query = (
    path: string,
    bearer: string | undefined,
    body: string = '{ projectScope { organizationId projectId } }',
  ) => {
    const call = request(app.getHttpServer()).post(path).send({ query: body });

    return bearer ? call.set('Authorization', `Bearer ${bearer}`) : call;
  };

  const restGet = (path: string, bearer: string | undefined) => {
    const call = request(app.getHttpServer()).get(path);

    return bearer ? call.set('Authorization', `Bearer ${bearer}`) : call;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AccessTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(
      new PrismaExceptionFilter(),
      new HttpExceptionFilter(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a signed-in project member and exposes the scope ids from the route', async () => {
    const response = await query(graphqlPath(), token(MEMBER)).expect(200);

    expect(response.body.data.projectScope).toEqual({
      organizationId: ORG,
      projectId: PROJECT,
    });
  });

  const expectSameRejection = (
    graphql: request.Response,
    rest: request.Response,
  ) => {
    expect(graphql.status).toBe(rest.status);
    expect(graphql.body.code).toBe(rest.body.code);
    expect(graphql.body.message).toBe(rest.body.message);
  };

  it('rejects an unauthenticated request the way REST does', async () => {
    const rest = await restGet(restPath(), undefined).expect(401);
    const graphql = await query(graphqlPath(), undefined);

    expectSameRejection(graphql, rest);
  });

  it('rejects anonymous requests that never select a resolver field', async () => {
    const rest = await restGet(restPath(), undefined).expect(401);
    const typename = await query(graphqlPath(), undefined, '{ __typename }');
    const malformed = await query(graphqlPath(), undefined, '{ projectScope');
    const mutation = await query(
      graphqlPath(),
      undefined,
      'mutation { projectScope { projectId } }',
    );

    expectSameRejection(typename, rest);
    expectSameRejection(malformed, rest);
    expectSameRejection(mutation, rest);
  });

  it('rejects a project the user cannot access the way REST does', async () => {
    const rest = await restGet(
      restPath(ORG, OTHER_PROJECT),
      token(MEMBER),
    ).expect(403);
    const graphql = await query(graphqlPath(ORG, OTHER_PROJECT), token(MEMBER));

    expectSameRejection(graphql, rest);
  });

  it('rejects a non-member of the organization the way REST does', async () => {
    const rest = await restGet(restPath(), token(OUTSIDER)).expect(403);
    const graphql = await query(graphqlPath(), token(OUTSIDER));

    expectSameRejection(graphql, rest);
  });

  it('answers malformed scope ids with 400, not a membership 403', async () => {
    const rest = await restGet(
      restPath('not-a-uuid', PROJECT),
      token(MEMBER),
    ).expect(400);
    const graphql = await query(
      graphqlPath('not-a-uuid', PROJECT),
      token(MEMBER),
    );

    expectSameRejection(graphql, rest);
  });

  it('protects a resolver that declares no access decorator', async () => {
    const anonymous = await query(graphqlPath(), undefined, '{ undecorated }');
    const outsider = await query(
      graphqlPath(),
      token(OUTSIDER),
      '{ undecorated }',
    );
    const member = await query(graphqlPath(), token(MEMBER), '{ undecorated }');

    expect(anonymous.status).toBe(401);
    expect(outsider.status).toBe(403);
    expect(member.body.data).toEqual({ undecorated: 'secret' });
  });

  it('rejects GET, which the endpoint does not serve', async () => {
    const response = await request(app.getHttpServer())
      .get(graphqlPath())
      .query({ query: '{ projectScope { projectId } }' })
      .set('Authorization', `Bearer ${token(MEMBER)}`);

    expect(response.status).toBe(405);
    expect(response.body.data).toBeUndefined();
  });

  it('rejects mutation operations from a signed-in member', async () => {
    const response = await query(
      graphqlPath(),
      token(MEMBER),
      'mutation { projectScope { projectId } }',
    );

    expect(response.status).toBe(400);
    expect(response.body.data).toBeUndefined();
    expect(response.body.errors).toHaveLength(1);
  });

  it('runs a root query field inside the request event context', async () => {
    const response = await query(
      graphqlPath(),
      token(MEMBER),
      '{ eventScope }',
    ).expect(200);

    expect(response.body.data.eventScope).toBe(
      [ORG, PROJECT, MEMBER].join('|'),
    );
  });

  it('gives nested fields the signed-in viewer only through runAsViewer', async () => {
    const response = await query(
      graphqlPath(),
      token(MEMBER),
      '{ viewerProbe { rootViewer bareNestedViewer nestedViewer } }',
    ).expect(200);

    expect(response.body.data.viewerProbe).toEqual({
      rootViewer: MEMBER,
      bareNestedViewer: 'undefined',
      nestedViewer: MEMBER,
    });
  });

  describe('errors thrown inside a resolver', () => {
    beforeAll(() => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    const failQuery = (kind: FailureKind) =>
      query(graphqlPath(), token(MEMBER), `{ fail(kind: "${kind}") }`);
    const restFail = (kind: FailureKind) =>
      restGet(`${restPath()}/fail/${kind}`, token(MEMBER));

    it('carries the Prisma error code REST publishes', async () => {
      const rest = await restFail('prisma').expect(409);
      const graphql = await failQuery('prisma');

      expect(graphql.body.errors[0].extensions.code).toBe(rest.body.error.code);
      expect(graphql.body.errors[0].extensions.http.status).toBe(rest.status);
    });

    it('carries the stable code of an HttpException', async () => {
      const rest = await restFail('stableCode').expect(403);
      const graphql = await failQuery('stableCode');

      expect(graphql.body.errors[0].extensions.code).toBe(rest.body.code);
      expect(graphql.body.errors[0].message).toBe(rest.body.message);
    });
  });
});

describe('read-only GraphQL endpoint rate limiting', () => {
  let app: INestApplication;
  const LIMIT = 2;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AccessTestModule,
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: LIMIT }]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ApiKeyThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (userId: string, body = '{ projectScope { projectId } }') =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${ORG}/projects/${PROJECT}/graphql`)
      .set('Authorization', `Bearer ${token(userId)}`)
      .send({ query: body });

  it('limits each signed-in user separately, not each client address', async () => {
    for (let i = 0; i < LIMIT; i++) {
      await send(MEMBER).expect(200);
    }

    const overLimit = await send(MEMBER);

    // Both users share one client address. Only the user over the limit is
    // throttled, so the limit is keyed on the user the middleware signed in.
    const otherUser = await send(SECOND_MEMBER);

    expect(JSON.stringify(overLimit.body.errors)).toContain('429');
    expect(otherUser.status).toBe(200);
    expect(otherUser.body.errors).toBeUndefined();
  });

  it('counts a query once however many root fields it selects', async () => {
    const fourFields =
      '{ a: projectScope { projectId } b: projectScope { projectId } c: projectScope { projectId } d: projectScope { projectId } }';

    for (let i = 0; i < LIMIT; i++) {
      const response = await send(THIRD_MEMBER, fourFields).expect(200);

      expect(response.body.errors).toBeUndefined();
    }

    const overLimit = await send(THIRD_MEMBER);

    expect(JSON.stringify(overLimit.body.errors)).toContain('429');
  });
});
