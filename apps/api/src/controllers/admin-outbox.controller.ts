import { Controller, Get, UseGuards } from '@nestjs/common';
import { OutboxStore } from '../services/outbox-store.service';
import { OUTBOX_STORE_TOKEN } from '../core/events/tokens';
import { Inject } from '@nestjs/common';
import { DevAdminGuard } from '../auth/guards/dev-admin.guard';

@Controller('admin/outbox')
@UseGuards(DevAdminGuard)
export class AdminOutboxController {
  constructor(
    @Inject(OUTBOX_STORE_TOKEN) private readonly outbox: OutboxStore,
  ) {}

  @Get('stats')
  async getStats() {
    return this.outbox.getOutboxStats();
  }
}
