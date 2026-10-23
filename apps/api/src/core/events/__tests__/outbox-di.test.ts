import { Test, TestingModule } from '@nestjs/testing';
import { OutboxPublisher } from '../../events/outbox-publisher.service';
import { OutboxPublisherModule } from '../../events/outbox-publisher.module';
import { OUTBOX_PUBLISHER_TOKEN, MESSAGE_BUS_TOKEN } from '../../events/tokens';
import { ApiMetricsService } from '../../metrics/api-metrics.service';

describe('OutboxDispatcherModule DI', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [OutboxPublisherModule],
    })
      .overrideProvider(OutboxPublisher)
      .useValue({ startPublisher: jest.fn(), stopPublisher: jest.fn() })
      .overrideProvider(MESSAGE_BUS_TOKEN)
      .useValue({ publish: jest.fn(), subscribe: jest.fn() })
      .compile();
  });

  it('provides same instance for token and class', () => {
    const byClass = moduleRef.get(OutboxPublisher);
    const byToken = moduleRef.get(OUTBOX_PUBLISHER_TOKEN);
    expect(byClass).toBe(byToken);
    expect(moduleRef.get(ApiMetricsService)).toBe(
      moduleRef.get(ApiMetricsService),
    );
  });
});
