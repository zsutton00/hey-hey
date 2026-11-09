// temporal.module.ts
import {
  Module,
  Provider,
  Global,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Connection, Client } from '@temporalio/client';
import { isLocalApplication } from '../deployment-environment';
const INDEXED_VALUE_TYPE_KEYWORD_LIST = 7;

export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';

export const InjectTemporalClient = () => Inject(TEMPORAL_CLIENT);

const temporalClientProvider: Provider = {
  provide: TEMPORAL_CLIENT,
  useFactory: async () => {
    if (isLocalApplication()) {
      // Construct no live connection and reject RPCs before gRPC can send them.
      // Local CLI-owned execution is a separate owner, not a Temporal fallback.
      const connection = Connection.lazy({
        interceptors: [
          () => {
            throw new ServiceUnavailableException(
              'Temporal workflows are unavailable in the local application. Use CLI-owned execution.',
            );
          },
        ],
      });
      return new Client({ connection });
    }
    const logger = new Logger(TemporalModule.name);
    const connection = await Connection.connect({
      // Your Temporal service address
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
    try {
      await connection.operatorService.addSearchAttributes({
        namespace,
        searchAttributes: {
          UserId: INDEXED_VALUE_TYPE_KEYWORD_LIST,
          SourceConversationID: INDEXED_VALUE_TYPE_KEYWORD_LIST,
        },
      });
      logger.log(
        `[Temporal] Registered search attributes in namespace ${namespace}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already exists')) {
        throw error;
      }
      logger.debug(
        `[Temporal] Search attributes already registered in namespace ${namespace}`,
      );
    }

    return new Client({
      connection,
      namespace,
    });
  },
};

@Global()
@Module({
  providers: [temporalClientProvider],
  exports: [temporalClientProvider],
})
export class TemporalModule {}
