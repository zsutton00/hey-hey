import { Module } from '@nestjs/common';
import { CoreDomainModule } from '../../domain/core-domain.module';
import {
  EntityRefResolver,
  TrackedEntityResolver,
  WorkItemGraphReferenceResolver,
} from './entity-ref.resolver';
import { WorkItemResolver } from './work-item.resolver';

/** Work-item reads on the Web UI GraphQL endpoint. */
@Module({
  imports: [CoreDomainModule],
  providers: [
    WorkItemResolver,
    EntityRefResolver,
    TrackedEntityResolver,
    WorkItemGraphReferenceResolver,
  ],
})
export class WorkItemGraphqlModule {}
