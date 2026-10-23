import { ReportService } from '../reports/report.service';
import { Test } from '@nestjs/testing';
import { ActivityCorrelationService } from '../activity-correlation.service';
import { ActivityCorrelationAugmentationService } from '../activity-correlation/activity-correlation-augmentation.service';
import { ActivityCorrelationSeedSelectorService } from '../activity-correlation/activity-correlation-seed-selector.service';
import { ActivityCorrelationTraversalService } from '../activity-correlation/activity-correlation-traversal.service';
import { ActivityCorrelationRecordAssemblerService } from '../activity-correlation/activity-correlation-record-assembler.service';
import { GraphsClientService } from '../graphs-client.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';

describe('Activity correlation dependency injection', () => {
  it('resolves reports when a circular import leaves constructor metadata undefined', async () => {
    // Production TypeScript emits undefined here if the ReportService module
    // has not finished loading. Isolated test transpilation emits Object
    // instead, so recreate the production condition explicitly.
    const originals = [
      { target: ActivityCorrelationService, index: 2 },
      { target: ActivityCorrelationAugmentationService, index: 1 },
    ].map(({ target, index }) => {
      const paramTypes = Reflect.getMetadata('design:paramtypes', target);
      const circularParamTypes = [...paramTypes];
      circularParamTypes[index] = undefined;
      Reflect.defineMetadata('design:paramtypes', circularParamTypes, target);
      return { target, paramTypes };
    });

    try {
      const module = await Test.createTestingModule({
        providers: [
          ActivityCorrelationService,
          ActivityCorrelationAugmentationService,
          ...[
            ReportService,
            PrismaService,
            DOMAIN_EVENT_PUBLISHER_TOKEN,
            GraphsClientService,
            ActivityCorrelationSeedSelectorService,
            ActivityCorrelationTraversalService,
            ActivityCorrelationRecordAssemblerService,
          ].map((provide) => ({ provide, useValue: {} })),
        ],
      }).compile();

      expect(module.get(ActivityCorrelationService)).toBeInstanceOf(
        ActivityCorrelationService,
      );
      expect(module.get(ActivityCorrelationAugmentationService)).toBeInstanceOf(
        ActivityCorrelationAugmentationService,
      );
      await module.close();
    } finally {
      for (const { target, paramTypes } of originals) {
        Reflect.defineMetadata('design:paramtypes', paramTypes, target);
      }
    }
  });
});
