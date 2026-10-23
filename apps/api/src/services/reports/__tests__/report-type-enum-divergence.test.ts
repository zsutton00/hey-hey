import {
  ReportAudience as PrismaReportAudience,
  ReportType as PrismaReportType,
  AgentSessionType as PrismaAgentSessionType,
  ProjectReportStatus as PrismaProjectReportStatus,
} from '@prisma/client';
import {
  ReportAudience as OpenApiReportAudience,
  ReportType as OpenApiReportType,
  AgentSessionType as OpenApiAgentSessionType,
  ProjectReportStatus as OpenApiProjectReportStatus,
} from 'src/generated';

const expectEnumParity = <TPrisma extends string, TOpenApi extends string>(
  prismaEnum: Record<string, TPrisma>,
  openApiEnum: Record<string, TOpenApi>,
) => {
  const prismaValues = new Set(Object.values(prismaEnum));
  const openApiValues = new Set(Object.values(openApiEnum));

  const missingFromPrisma = [...openApiValues].filter(
    (value) => !prismaValues.has(value as unknown as TPrisma),
  );
  const extraInPrisma = [...prismaValues].filter(
    (value) => !openApiValues.has(value as unknown as TOpenApi),
  );

  expect({ missingFromPrisma, extraInPrisma }).toEqual({
    missingFromPrisma: [],
    extraInPrisma: [],
  });
};

describe('ReportType enum parity', () => {
  it('AgentSessionType and project report lifecycle enums match OpenAPI', () => {
    expectEnumParity(PrismaAgentSessionType, OpenApiAgentSessionType);
    expectEnumParity(PrismaProjectReportStatus, OpenApiProjectReportStatus);
  });
  it('Prisma ReportType matches OpenAPI ReportType exactly', () => {
    expectEnumParity(PrismaReportType, OpenApiReportType);
  });

  it('Prisma ReportAudience matches OpenAPI ReportAudience exactly', () => {
    expectEnumParity(PrismaReportAudience, OpenApiReportAudience);
  });
});
