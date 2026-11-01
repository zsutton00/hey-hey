import { Global, Module } from '@nestjs/common';
import { GraphReadScope } from './graph-read-scope';
import { ReadVisibilityService } from './read-visibility.service';

@Global()
@Module({
  providers: [ReadVisibilityService, GraphReadScope],
  exports: [ReadVisibilityService, GraphReadScope],
})
export class ReadRestrictionModule {}
