import { Module } from '@nestjs/common';
import { OpenItemsController } from '../../controllers/open-items.controller';
import { OpenItemsRepository } from './open-items.repository';
import { OpenItemsService } from './open-items.service';
import { OpenItemsGoalPromotionService } from './open-items-goal-promotion.service';
import { CoreDomainModule } from '../../domain/core-domain.module';

import { WebsocketsModule } from '../../core/websockets/websockets.module';

@Module({
  imports: [WebsocketsModule, CoreDomainModule],
  controllers: [OpenItemsController],
  providers: [
    OpenItemsRepository,
    OpenItemsService,
    OpenItemsGoalPromotionService,
  ],
})
export class OpenItemsModule {}
