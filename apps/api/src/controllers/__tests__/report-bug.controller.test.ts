import { ReportBugController } from '../report-bug.controller';
import type { ReportBugService } from 'src/services/report-bug.service';
import type { UserId } from 'src/types';

describe('ReportBugController', () => {
  it('forwards the authenticated user and exact report contract', async () => {
    const reportBugService = {
      reportBug: jest.fn().mockResolvedValue({
        bugId: '44444444-4444-4444-8444-444444444444',
      }),
    };
    const controller = new ReportBugController(
      reportBugService as unknown as ReportBugService,
    );
    const input = {
      description: 'Saving a feature fails.',
      productLocation: '/projects/project-1/features/feature-1',
      correlationId: 'correlation-123',
      diagnosticConsent: true,
    };
    const userId = '55555555-5555-4555-8555-555555555555' as UserId;

    await expect(controller.reportBug(input, userId)).resolves.toEqual({
      bugId: '44444444-4444-4444-8444-444444444444',
    });
    expect(reportBugService.reportBug).toHaveBeenCalledWith(
      input,
      '55555555-5555-4555-8555-555555555555',
    );
  });
});
