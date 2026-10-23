import { describe, expect, it } from 'vitest';
import { ReportRelatedEntityType } from '../../../shared/api/index';
import { planShapingFeatureSyncAnalyzeHandler } from '../analyze.handler';
import { CreateReportTool } from '../../submission-tools/create-report-tool';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';

describe('Plan report entity contract', () => {
  it('keeps report anchors on TASK while requirement citations retain PLAN identity', () => {
    const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt({
      planId: 'plan-1',
      designDocId: 'doc-1',
      userMessage: '',
    });
    expect(prompt).toContain('entityType: "TASK", entityId: <current plan id>');
    expect(prompt).toContain('entityType: "PLAN", entityId: "<plan id>"');
    expect(prompt).toContain('sections[requirements]');
    expect(prompt).toContain('stored durable `id`');
    expect(prompt).not.toContain('requirementsStructured');
    expect(prompt).not.toContain('content-hash');
  });

  it('advertises only generated report entity types for primary and linked references', () => {
    const tool = new CreateReportTool(makeCreateReportProxy());
    expect(tool.inputSchema).toMatchObject({
      properties: {
        entities: {
          items: { properties: { entityType: { enum: Object.values(ReportRelatedEntityType) } } },
        },
        linkedEntities: {
          items: { properties: { entityType: { enum: Object.values(ReportRelatedEntityType) } } },
        },
      },
    });
    expect(Object.values(ReportRelatedEntityType)).not.toContain('PLAN');
  });
});
