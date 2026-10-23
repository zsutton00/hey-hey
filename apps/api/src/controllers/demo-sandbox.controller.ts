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
  cookieAttributes,
  setBrowserSessionCookies,
} from '../auth/browser-session-cookies';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  DemoSandboxAvailabilityDto,
  DemoSandboxResponseDto,
  ProvisionDemoSandboxDto,
} from '../generated';
import {
  DemoSandboxAdmission,
  DemoSandboxAdmissionService,
  DemoSandboxRequestContext,
} from '../services/demo-sandbox/demo-sandbox-admission.service';
import { DemoSandboxProgramService } from '../services/demo-sandbox/demo-sandbox-program.service';
import {
  DEMO_BINDING_COOKIE_MAX_AGE_MILLISECONDS,
  DEMO_BINDING_COOKIE_NAME,
} from '../services/demo-sandbox/demo-sandbox.constants';
import { ProvisionDemoSandboxPipe } from './demo-sandbox.validation';

@ApiTags('DemoSandboxes')
@Controller('api/v1/demo-sandboxes')
export class DemoSandboxController {
  constructor(
    private readonly admission: DemoSandboxAdmissionService,
    private readonly program: DemoSandboxProgramService,
  ) {}

  @Public()
  @Get('availability')
  async availability(): Promise<DemoSandboxAvailabilityDto> {
    return { available: await this.program.isAvailable() };
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async provision(
    @Body(new ProvisionDemoSandboxPipe()) body: ProvisionDemoSandboxDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DemoSandboxResponseDto> {
    return this.publish(
      response,
      await this.admission.provision(body, this.context(request)),
    );
  }

  @Public()
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DemoSandboxResponseDto> {
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

  /** Called only after the admission transaction has committed. */
  private publish(
    response: Response,
    admission: DemoSandboxAdmission,
  ): DemoSandboxResponseDto {
    setBrowserSessionCookies(response, admission.session);
    if (admission.bindingSecret) {
      response.cookie(DEMO_BINDING_COOKIE_NAME, admission.bindingSecret, {
        ...cookieAttributes('/'),
        maxAge: DEMO_BINDING_COOKIE_MAX_AGE_MILLISECONDS,
      });
    }
    return admission.sandbox;
  }
}
