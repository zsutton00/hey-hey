import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { CoreDomainModule } from '../../domain/core-domain.module';
import { OAuthService } from './oauth.service';
import { OAuthController } from './oauth.controller';

@Module({
  imports: [AuthModule, CoreDomainModule],
  controllers: [OAuthController],
  providers: [OAuthService],
})
export class OAuthModule {}
