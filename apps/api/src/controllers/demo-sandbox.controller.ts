import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import {
  browserSessionRequestMetadata,
  setBrowserSessionCookies,
} from '../auth/browser-session-cookies';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  DemoSandboxAdmissionDto,
  DemoSandboxAvailabilityDto,
  DemoSandboxResponseDto,
  ProvisionDemoSandboxDto,
} from '../generated';
import {
  DemoSandboxAdmission,
  DemoSandboxAdmissionService,
  DemoSandboxRequestContext,
} from '../services/demo-sandbox/demo-sandbox-admission.service';
import { isDemoSandboxEnabled } from '../services/demo-sandbox/demo-sandbox-program.service';
import { setDemoBindingCookie } from '../services/demo-sandbox/demo-binding-cookie';
import { DEMO_BINDING_COOKIE_NAME } from '../services/demo-sandbox/demo-sandbox.constants';
import { ProvisionDemoSandboxPipe } from './demo-sandbox.validation';

@ApiTags('DemoSandboxes')
@Controller('api/v1/demo-sandboxes')
export class DemoSandboxController {
  constructor(private readonly admission: DemoSandboxAdmissionService) {}

  @Public()
  @Get('availability')
  availability(): DemoSandboxAvailabilityDto {
    return { available: isDemoSandboxEnabled() };
  }

  /** 202 when a new sandbox was reserved; 200 for this browser's existing one. */
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async provision(
    @Body(new ProvisionDemoSandboxPipe()) body: ProvisionDemoSandboxDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DemoSandboxAdmissionDto> {
    const admission = await this.admission.provision(
      body,
      this.context(request),
    );
    if (admission.bindingSecret) response.status(HttpStatus.ACCEPTED);
    return this.publish(response, admission);
  }

  @Public()
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DemoSandboxAdmissionDto> {
    return this.publish(
      response,
      await this.admission.resume(this.context(request)),
    );
  }

  @Get('current')
  @UseGuards(JwtAuthGuard)
  current(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DemoSandboxResponseDto> {
    return this.admission.current(user.userId);
  }

  private context(request: Request): DemoSandboxRequestContext {
    const bindingSecret: unknown = request.cookies?.[DEMO_BINDING_COOKIE_NAME];
    return {
      ...(typeof bindingSecret === 'string' ? { bindingSecret } : {}),
      ipAddress: request.ip,
      sessionMetadata: browserSessionRequestMetadata(request),
    };
  }

  /**
   * Called only after the admission transaction has committed. The binding
   * cookie is published with the reservation; a session only for an ACTIVE
   * sandbox.
   */
  private publish(
    response: Response,
    admission: DemoSandboxAdmission,
  ): DemoSandboxAdmissionDto {
    if (admission.session) {
      setBrowserSessionCookies(response, admission.session);
    }
    if (admission.bindingSecret) {
      setDemoBindingCookie(response, admission.bindingSecret);
    }
    return admission.admission;
  }
}
