import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OrganizationAccountDataDeletionOwner } from '../src/services/organization-account-data-deletion.owner';
import type { OrganizationId } from '../src/types';

async function main(): Promise<void> {
  const organizationId = process.argv[2];
  if (!organizationId) {
    throw new Error('Usage: pnpm account-closure:run -- <organization-id>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const owner = app.get(OrganizationAccountDataDeletionOwner);
    const executed = await owner.executeForOrganization(
      organizationId as OrganizationId,
    );
    if (!executed) {
      throw new Error(
        'No reached, retryable closure exists for the organization',
      );
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const failureType =
    error instanceof Error ? error.constructor.name : 'UnknownError';
  console.error(`Account closure operator execution failed: ${failureType}`);
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
    if (error.cause !== undefined) {
      console.error('Caused by:', error.cause);
    }
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
