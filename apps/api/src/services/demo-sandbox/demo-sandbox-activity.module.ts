import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DemoSandboxActivityService } from './demo-sandbox-activity.service';

/** Leaf module so authentication paths can record activity without depending on teardown. */
@Module({
  imports: [PrismaModule],
  providers: [DemoSandboxActivityService],
  exports: [DemoSandboxActivityService],
})
export class DemoSandboxActivityModule {}
