import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoreDomainModule } from '../../domain/core-domain.module';
import { AccountPasskeyController } from './account-passkey.controller';
import { AccountPasskeyService } from './account-passkey.service';
import { AccountProofThrottleService } from './account-proof-throttle.service';

/** Account-login passkeys; separate from controller credentials. */
@Module({
  imports: [AuthModule, PrismaModule, CoreDomainModule],
  controllers: [AccountPasskeyController],
  providers: [AccountPasskeyService, AccountProofThrottleService],
})
export class AccountPasskeyModule {}
