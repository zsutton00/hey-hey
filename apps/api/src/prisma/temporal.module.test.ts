import { Test } from '@nestjs/testing';
import { Client, Connection } from '@temporalio/client';
import { TemporalModule, TEMPORAL_CLIENT } from './temporal.module';

const savedEnvironment = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnvironment };
  jest.restoreAllMocks();
});

describe('application Temporal startup', () => {
  it('local application starts without connecting and rejects workflow RPCs before network access', async () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'local';
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
    const connect = jest.spyOn(Connection, 'connect');
    const module = await Test.createTestingModule({
      imports: [TemporalModule],
    }).compile();
    const client = module.get<Client>(TEMPORAL_CLIENT);
    expect(connect).not.toHaveBeenCalled();
    await expect(
      client.workflow.start('not-a-local-workflow', {
        taskQueue: 'test',
        workflowId: 'local-no-temporal',
      }),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining('Temporal workflows are unavailable'),
      },
    });
    expect(connect).not.toHaveBeenCalled();
    await client.connection.close();
    await module.close();
  });

  it('hosted startup still connects and registers search attributes', async () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'production';
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
    const connection = Connection.lazy();
    const attributes = jest
      .spyOn(connection.operatorService, 'addSearchAttributes')
      .mockResolvedValue({ toJSON: () => ({}) });
    const connect = jest
      .spyOn(Connection, 'connect')
      .mockResolvedValue(connection);
    const module = await Test.createTestingModule({
      imports: [TemporalModule],
    }).compile();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(attributes).toHaveBeenCalledTimes(1);
    await connection.close();
    await module.close();
  });
});
