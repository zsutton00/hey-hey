import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServerSigningKeyService } from './server-signing-key.service';

@Module({
  imports: [ConfigModule],
  providers: [ServerSigningKeyService],
  exports: [ServerSigningKeyService],
})
export class ServerSigningModule {}
