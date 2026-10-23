/* eslint-disable */
// We'll import this dynamically to avoid TypeScript issues
type SqlitePrismaClient = any;

// Import the same extension used by PrismaService
import { idBrandingExtension } from '../../prisma/prisma.service';

/**
 * Wrapper for SQLite Prisma Client that handles JSON serialization/deserialization
 * SQLite stores JSON as strings, so we need to convert between objects and strings
 */
export class SqlitePrismaWrapper {
  private client: SqlitePrismaClient;
  private extendedClient: any;

  constructor(client: SqlitePrismaClient) {
    this.client = client;
    // Apply the same ID branding extension that PrismaService uses
    this.extendedClient = client.$extends(idBrandingExtension);
  }

  $transaction(fn: (tx: any) => Promise<any>) {
    return this.client.$transaction(async (tx: any) => {
      // Create a wrapper for the transaction client
      const txWrapper = {
        ...tx,
        conversation: {
          ...tx.conversation,
          create: async (args: any) => {
            const result = await tx.conversation.create(args);
            return result;
          },
        },
        message: {
          ...tx.message,
          create: async (args: any) => {
            const data = { ...args.data };
            // Convert JSON fields to strings for SQLite
            if (data.data && typeof data.data === 'object') {
              data.data = JSON.stringify(data.data);
            }

            const result = await tx.message.create({
              ...args,
              data,
            });

            // Convert back to objects
            return {
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
            };
          },
          update: async (args: any) => {
            const data = { ...args.data };
            if (data.data && typeof data.data === 'object') {
              data.data = JSON.stringify(data.data);
            }

            const result = await tx.message.update({
              ...args,
              data,
            });

            return {
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
            };
          },
        },
        outboxEvent: this.createOutboxEventHandler(tx.outboxEvent),
        entityRegistry: tx.entityRegistry,
        artifact: {
          ...tx.artifact,
          create: async (args: any) => {
            const data = { ...args.data };
            // Convert JSON fields to strings for SQLite
            if (data.data && typeof data.data === 'object') {
              data.data = JSON.stringify(data.data);
            }
            // Convert tags array to JSON string for SQLite
            if (data.tags && Array.isArray(data.tags)) {
              data.tags = JSON.stringify(data.tags);
            }

            const result = await tx.artifact.create({
              ...args,
              data,
            });

            // Convert back to objects
            return {
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
              tags:
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags,
            };
          },
          createMany: async (args: any) => {
            // Serialize data field to JSON string for SQLite storage for all items
            if (args.data && Array.isArray(args.data)) {
              args.data = args.data.map((item: any) => ({
                ...item,
                data:
                  typeof item.data === 'object'
                    ? JSON.stringify(item.data)
                    : item.data,
                tags: Array.isArray(item.tags)
                  ? JSON.stringify(item.tags)
                  : item.tags,
              }));
            }
            return await tx.artifact.createMany(args);
          },
          findUnique: async (args: any) => {
            const result = await tx.artifact.findUnique(args);
            if (!result) return result;
            return {
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
              tags:
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags,
            };
          },
          findFirst: async (args: any) => {
            const result = await tx.artifact.findFirst(args);
            if (!result) return result;
            return {
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
              tags:
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags,
            };
          },
          findMany: async (args: any) => {
            const results = await tx.artifact.findMany(args);
            return results.map((result: any) => ({
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
              tags:
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags,
            }));
          },
          update: async (args: any) => {
            const data = { ...args.data };
            // Convert JSON fields to strings for SQLite
            if (data.data && typeof data.data === 'object') {
              data.data = JSON.stringify(data.data);
            }
            // Convert tags array to JSON string for SQLite
            if (data.tags && Array.isArray(data.tags)) {
              data.tags = JSON.stringify(data.tags);
            }

            const result = await tx.artifact.update({
              ...args,
              data,
            });

            // Convert back to objects
            return {
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
              tags:
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags,
            };
          },
        },
      };

      return fn(txWrapper);
    });
  }

  get $connect() {
    return this.client.$connect.bind(this.client);
  }

  get $disconnect() {
    return this.client.$disconnect.bind(this.client);
  }

  get $executeRawUnsafe() {
    return this.client.$executeRawUnsafe.bind(this.client);
  }

  // Add $transaction method at top level for services that don't use db property
  // This references the $transaction method defined earlier in the class

  private createOutboxEventHandler(outboxEventClient: any) {
    return {
      ...outboxEventClient,
      create: async (args: any) => {
        const data = { ...args.data };
        // Convert JSON fields to strings for SQLite
        if (data.payload && typeof data.payload === 'object') {
          data.payload = JSON.stringify(data.payload);
        }
        if (data.headers && typeof data.headers === 'object') {
          data.headers = JSON.stringify(data.headers);
        }

        const result = await outboxEventClient.create({
          ...args,
          data,
        });

        return result;
      },
      findMany: async (args: any) => {
        const results = await outboxEventClient.findMany(args);
        return results.map((result: any) => ({
          ...result,
          payload:
            typeof result.payload === 'string'
              ? JSON.parse(result.payload)
              : result.payload,
          headers:
            typeof result.headers === 'string'
              ? JSON.parse(result.headers)
              : result.headers,
        }));
      },
      findFirst: async (args: any) => {
        const result = await outboxEventClient.findFirst(args);
        if (!result) return result;
        return {
          ...result,
          payload:
            typeof result.payload === 'string'
              ? JSON.parse(result.payload)
              : result.payload,
          headers:
            typeof result.headers === 'string'
              ? JSON.parse(result.headers)
              : result.headers,
        };
      },
      update: async (args: any) => {
        const data = args.data ? { ...args.data } : undefined;
        if (data) {
          // Convert JSON fields to strings for SQLite
          if (data.payload && typeof data.payload === 'object') {
            data.payload = JSON.stringify(data.payload);
          }
          if (data.headers && typeof data.headers === 'object') {
            data.headers = JSON.stringify(data.headers);
          }
        }

        const result = await outboxEventClient.update({
          ...args,
          data,
        });

        return {
          ...result,
          payload:
            typeof result.payload === 'string'
              ? JSON.parse(result.payload)
              : result.payload,
          headers:
            typeof result.headers === 'string'
              ? JSON.parse(result.headers)
              : result.headers,
        };
      },
    };
  }

  get outboxEvent() {
    return this.createOutboxEventHandler(this.client.outboxEvent);
  }

  private createEventLogHandler(eventLogClient: any) {
    return {
      ...eventLogClient,
      create: async (args: any) => {
        const data = { ...args.data };
        // Convert JSON fields to strings for SQLite
        if (data.payload && typeof data.payload === 'object') {
          data.payload = JSON.stringify(data.payload);
        }
        if (data.metadata && typeof data.metadata === 'object') {
          data.metadata = JSON.stringify(data.metadata);
        }
        // Convert publishedTo array to JSON string for SQLite
        if (data.publishedTo && Array.isArray(data.publishedTo)) {
          data.publishedTo = JSON.stringify(data.publishedTo);
        }

        const result = await eventLogClient.create({
          ...args,
          data,
        });

        return result;
      },
      findMany: async (args?: any) => {
        const results = await eventLogClient.findMany(args);
        return results.map((result: any) => ({
          ...result,
          payload:
            typeof result.payload === 'string'
              ? JSON.parse(result.payload)
              : result.payload,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          publishedTo:
            typeof result.publishedTo === 'string'
              ? JSON.parse(result.publishedTo)
              : result.publishedTo,
        }));
      },
      findFirst: async (args?: any) => {
        const result = await eventLogClient.findFirst(args);
        if (!result) return result;
        return {
          ...result,
          payload:
            typeof result.payload === 'string'
              ? JSON.parse(result.payload)
              : result.payload,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          publishedTo:
            typeof result.publishedTo === 'string'
              ? JSON.parse(result.publishedTo)
              : result.publishedTo,
        };
      },
    };
  }

  get db() {
    return {
      $transaction: this.$transaction.bind(this),
      organization: this.extendedClient.organization,
      entityRegistry: this.extendedClient.entityRegistry,
      outboxEvent: this.outboxEvent,
      eventLog: this.createEventLogHandler(this.client.eventLog),
      user: this.extendedClient.user,
      project: this.extendedClient.project,
      organizationMember: this.extendedClient.organizationMember,
      conversation: this.conversation,
      initiative: this.extendedClient.initiative,
      projectInitiative: this.extendedClient.projectInitiative,
      tag: this.extendedClient.tag,
      flowExecution: this.flowExecution,
      integration: this.extendedClient.integration,
      artifact: {
        ...this.client.artifact,
        create: async (args: any) => {
          const data = { ...args.data };
          // Convert JSON fields to strings for SQLite
          if (data.data && typeof data.data === 'object') {
            data.data = JSON.stringify(data.data);
          }
          // Convert tags array to JSON string for SQLite
          if (data.tags && Array.isArray(data.tags)) {
            data.tags = JSON.stringify(data.tags);
          }

          const result = await this.client.artifact.create({
            ...args,
            data,
          });

          // Convert back to objects
          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
            tags:
              typeof result.tags === 'string'
                ? JSON.parse(result.tags)
                : result.tags,
          };
        },
        createMany: async (args: any) => {
          // Serialize data field to JSON string for SQLite storage for all items
          if (args.data && Array.isArray(args.data)) {
            args.data = args.data.map((item: any) => ({
              ...item,
              data:
                typeof item.data === 'object'
                  ? JSON.stringify(item.data)
                  : item.data,
              tags: Array.isArray(item.tags)
                ? JSON.stringify(item.tags)
                : item.tags,
            }));
          }
          return await this.client.artifact.createMany(args);
        },
        findUnique: async (args: any) => {
          const result = await this.client.artifact.findUnique(args);
          if (!result) return result;
          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
            tags:
              typeof result.tags === 'string'
                ? JSON.parse(result.tags)
                : result.tags,
          };
        },
        findFirst: async (args: any) => {
          const result = await this.client.artifact.findFirst(args);
          if (!result) return result;
          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
            tags:
              typeof result.tags === 'string'
                ? JSON.parse(result.tags)
                : result.tags,
          };
        },
        findMany: async (args: any) => {
          // Transform hasSome queries for SQLite compatibility
          if (args?.where?.tags?.hasSome) {
            const hasSomeValues = args.where.tags.hasSome;
            // For SQLite, we need to check if any of the hasSome values exist in the JSON array
            // We'll use a more basic approach that works with SQLite
            args = {
              ...args,
              where: {
                ...args.where,
                tags: undefined, // Remove the hasSome query for now
              },
            };

            // Get all results and filter in memory for SQLite compatibility
            const allResults = await this.client.artifact.findMany(args);
            const filteredResults = allResults.filter((result: any) => {
              if (!result.tags) return false;
              const tags =
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags;
              return (
                Array.isArray(tags) &&
                hasSomeValues.some((value: string) => tags.includes(value))
              );
            });

            return filteredResults.map((result: any) => ({
              ...result,
              data:
                typeof result.data === 'string'
                  ? JSON.parse(result.data)
                  : result.data,
              tags:
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags,
            }));
          }

          const results = await this.client.artifact.findMany(args);
          return results.map((result: any) => ({
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
            tags:
              typeof result.tags === 'string'
                ? JSON.parse(result.tags)
                : result.tags,
          }));
        },
        update: async (args: any) => {
          const data = { ...args.data };
          // Convert JSON fields to strings for SQLite
          if (data.data && typeof data.data === 'object') {
            data.data = JSON.stringify(data.data);
          }
          // Convert tags array to JSON string for SQLite
          if (data.tags && Array.isArray(data.tags)) {
            data.tags = JSON.stringify(data.tags);
          }

          const result = await this.client.artifact.update({
            ...args,
            data,
          });

          // Convert back to objects
          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
            tags:
              typeof result.tags === 'string'
                ? JSON.parse(result.tags)
                : result.tags,
          };
        },
        count: async (args: any) => {
          // Transform hasSome queries for SQLite compatibility
          if (args?.where?.tags?.hasSome) {
            const hasSomeValues = args.where.tags.hasSome;
            // For SQLite, we need to check if any of the hasSome values exist in the JSON array
            // We'll use a more basic approach that works with SQLite
            const findManyArgs = {
              ...args,
              where: {
                ...args.where,
                tags: undefined, // Remove the hasSome query for now
              },
            };

            // Get all results and filter in memory for SQLite compatibility
            const allResults = await this.client.artifact.findMany(findManyArgs);
            const filteredResults = allResults.filter((result: any) => {
              if (!result.tags) return false;
              const tags =
                typeof result.tags === 'string'
                  ? JSON.parse(result.tags)
                  : result.tags;
              return (
                Array.isArray(tags) &&
                hasSomeValues.some((value: string) => tags.includes(value))
              );
            });

            return filteredResults.length;
          }

          return await this.client.artifact.count(args);
        },
      },
      projectTag: this.extendedClient.projectTag,
      message: {
        ...this.client.message,
        create: async (args: any) => {
          const data = { ...args.data };
          // Convert JSON fields to strings for SQLite
          if (data.data && typeof data.data === 'object') {
            data.data = JSON.stringify(data.data);
          }

          const result = await this.client.message.create({
            ...args,
            data,
          });

          // Convert back to objects
          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
          };
        },
        findMany: async (args?: any) => {
          const results = await this.client.message.findMany(args);
          return results.map((result: any) => ({
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
          }));
        },
        update: async (args: any) => {
          const data = { ...args.data };
          if (data.data && typeof data.data === 'object') {
            data.data = JSON.stringify(data.data);
          }

          const result = await this.client.message.update({
            ...args,
            data,
          });

          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
          };
        },
        findUnique: async (args: any) => {
          const result = await this.client.message.findUnique(args);
          if (!result) return result;

          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
          };
        },
        findFirst: async (args: any) => {
          const result = await this.client.message.findFirst(args);
          if (!result) return result;

          return {
            ...result,
            data:
              typeof result.data === 'string'
                ? JSON.parse(result.data)
                : result.data,
          };
        },
        deleteMany: this.client.message.deleteMany.bind(this.client.message),
      },
      influence: this.extendedClient.influence,
      artifactInfluence: this.extendedClient.influence,
    };
  }

  // Direct access for simple operations
  get organization() {
    return this.extendedClient.organization;
  }

  get user() {
    return this.extendedClient.user;
  }

  get project() {
    return this.extendedClient.project;
  }

  get organizationMember() {
    return this.extendedClient.organizationMember;
  }

  get conversation() {
    return {
      ...this.client.conversation,
      create: async (args: any) => {
        const result = await this.client.conversation.create(args);
        return result;
      },
      findFirst: async (args?: any) => {
        const result = await this.client.conversation.findFirst(args);
        if (!result) return result;

        return result;
      },
      findUnique: async (args: any) => {
        const result = await this.client.conversation.findUnique(args);
        if (!result) return result;

        return result;
      },
      deleteMany: this.client.conversation.deleteMany.bind(
        this.client.conversation,
      ),
    };
  }

  get flowExecution() {
    return {
      ...this.extendedClient.flowExecution,
      create: async (args: any) => {
        const data = { ...args.data };
        // Convert JSON fields to strings for SQLite
        if (data.metadata && typeof data.metadata === 'object') {
          data.metadata = JSON.stringify(data.metadata);
        }
        if (data.flowState && typeof data.flowState === 'object') {
          data.flowState = JSON.stringify(data.flowState);
        }

        const result = await this.extendedClient.flowExecution.create({
          ...args,
          data,
        });

        // Convert back to objects
        return {
          ...result,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          flowState:
            typeof result.flowState === 'string'
              ? JSON.parse(result.flowState)
              : result.flowState,
        };
      },
      findFirst: async (args?: any) => {
        const result = await this.extendedClient.flowExecution.findFirst(args);
        if (!result) return result;

        return {
          ...result,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          flowState:
            typeof result.flowState === 'string'
              ? JSON.parse(result.flowState)
              : result.flowState,
        };
      },
      findUnique: async (args: any) => {
        const result = await this.extendedClient.flowExecution.findUnique(args);
        if (!result) return result;

        return {
          ...result,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          flowState:
            typeof result.flowState === 'string'
              ? JSON.parse(result.flowState)
              : result.flowState,
        };
      },
      update: async (args: any) => {
        const data = { ...args.data };
        // Convert JSON fields to strings for SQLite
        if (data.metadata && typeof data.metadata === 'object') {
          data.metadata = JSON.stringify(data.metadata);
        }
        if (data.flowState && typeof data.flowState === 'object') {
          data.flowState = JSON.stringify(data.flowState);
        }

        const result = await this.extendedClient.flowExecution.update({
          ...args,
          data,
        });

        // Convert back to objects
        return {
          ...result,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          flowState:
            typeof result.flowState === 'string'
              ? JSON.parse(result.flowState)
              : result.flowState,
        };
      },
      findMany: async (args?: any) => {
        const results = await this.extendedClient.flowExecution.findMany(args);
        return results.map((result: any) => ({
          ...result,
          metadata:
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata)
              : result.metadata,
          flowState:
            typeof result.flowState === 'string'
              ? JSON.parse(result.flowState)
              : result.flowState,
        }));
      },
    };
  }

  get message() {
    return this.db.message;
  }

  // Add eventLog getter for direct access (needed by OutboxPublisher)
  get eventLog() {
    return this.createEventLogHandler(this.client.eventLog);
  }
}
