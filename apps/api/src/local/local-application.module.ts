import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FIRST_PASSKEY_AUTHORITY } from '../auth/passkeys/first-passkey-authority';
import { CoreDomainModule } from '../domain/core-domain.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LocalAccessService } from './local-access.service';
import { LocalAuthController } from './local-auth.controller';
import { LocalFirstPasskeyAuthority } from './local-first-passkey-authority';

/**
 * Everything that exists only in a local installation. AppModule imports it
 * only when the process is a local application, so hosted route registration
 * and provider graphs contain none of it. Global so the shared passkey
 * service can find the optional first-passkey rule without importing local
 * code.
 */
@Global()
@Module({
  imports: [AuthModule, PrismaModule, CoreDomainModule],
  controllers: [LocalAuthController],
  providers: [
    LocalAccessService,
    LocalFirstPasskeyAuthority,
    {
      provide: FIRST_PASSKEY_AUTHORITY,
      useExisting: LocalFirstPasskeyAuthority,
    },
  ],
  exports: [FIRST_PASSKEY_AUTHORITY],
})
export class LocalApplicationModule {}
