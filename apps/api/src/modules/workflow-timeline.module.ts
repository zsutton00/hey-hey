import { Module } from '@nestjs/common';
import { WorkflowTimelineController } from '../controllers/workflow-timeline.controller';
import { WorkflowTimelineService } from '../services/workflow-timeline.service';
import { ElasticsearchService } from '../services/elasticsearch.service';

@Module({
  controllers: [WorkflowTimelineController],
  providers: [WorkflowTimelineService, ElasticsearchService],
  exports: [WorkflowTimelineService, ElasticsearchService],
})
export class WorkflowTimelineModule {}
