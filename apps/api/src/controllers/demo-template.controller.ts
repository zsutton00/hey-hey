import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type {
  DemoSandboxAdminOverviewDto,
  DemoSandboxProgramDto,
  DemoTemplateDto,
  SetDemoTemplateDto,
} from '../generated';
import { DemoTemplateService } from '../services/demo-sandbox/demo-template.service';
import { DemoSandboxProgramService } from '../services/demo-sandbox/demo-sandbox-program.service';
import { DemoSandboxProgramPipe } from './demo-sandbox.validation';
import { SetDemoTemplatePipe } from './demo-template.validation';

@ApiTags('DebugAdmin')
@Controller('api/v1/admin/demo-sandboxes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DemoTemplateController {
  constructor(
    private readonly templates: DemoTemplateService,
    private readonly program: DemoSandboxProgramService,
  ) {}

  @Get()
  async getOverview(): Promise<DemoSandboxAdminOverviewDto> {
    const [program, template, activeCount] = await Promise.all([
      this.program.get(),
      this.templates.getActive(),
      this.program.countActiveSandboxes(),
    ]);
    return { program, template, activeCount };
  }

  @Put('template')
  setTemplate(
    @Body(new SetDemoTemplatePipe()) input: SetDemoTemplateDto,
  ): Promise<DemoTemplateDto> {
    return this.templates.designate(input);
  }

  @Put('program')
  setProgram(
    @Body(new DemoSandboxProgramPipe()) input: DemoSandboxProgramDto,
  ): Promise<DemoSandboxProgramDto> {
    return this.program.set(input);
  }
}
