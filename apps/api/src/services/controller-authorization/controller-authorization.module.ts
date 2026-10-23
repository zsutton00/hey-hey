import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ControllerAuthorizationController } from '../../controllers/controller-authorization.controller';
import { WebsocketsModule } from '../../core/websockets/websockets.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ControllerAssertionVerifierService } from './controller-assertion-verifier.service';
import { ControllerAuthorizationService } from './controller-authorization.service';
import { ControllerAuthorizationWebAuthnConfigService } from './controller-authorization-webauthn-config.service';
import { ExecutionGrantService } from './execution-grant.service';
import { ControllerBrowserBindingService } from './controller-browser-binding.service';
import { ControllerBindingCookieService } from './controller-binding-cookie.service';
import { ControllerBindingOriginGuard } from '../../common/guards/controller-binding-origin.guard';

@Module({
  imports: [ConfigModule, PrismaModule, WebsocketsModule],
  controllers: [ControllerAuthorizationController],
  providers: [
    ControllerAuthorizationService,
    ControllerAssertionVerifierService,
    ControllerAuthorizationWebAuthnConfigService,
    ExecutionGrantService,
    ControllerBrowserBindingService,
    ControllerBindingCookieService,
    ControllerBindingOriginGuard,
  ],
  exports: [
    ControllerAuthorizationService,
    ExecutionGrantService,
    ControllerBrowserBindingService,
    ControllerBindingCookieService,
    ControllerBindingOriginGuard,
  ],
})
export class ControllerAuthorizationModule {}
