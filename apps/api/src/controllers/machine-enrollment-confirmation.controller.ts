import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import {
  ConfirmMachineEnrollmentRequestDto,
  ConfirmMachineEnrollmentResponseDto,
  PollMachineEnrollmentRequestDto,
  PollMachineEnrollmentResponseDto,
} from '../generated';
import { MachineEnrollmentConfirmationService } from '../services/machine-pairing/machine-enrollment-confirmation.service';

@ApiTags('Machines')
@Controller('api/v1/machines/enrollments')
export class MachineEnrollmentConfirmationController {
  constructor(
    private readonly machineEnrollmentConfirmationService: MachineEnrollmentConfirmationService,
  ) {}

  @Public()
  @Post(':enrollmentId/poll')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Poll machine enrollment confirmation state' })
  @ApiResponse({ status: 200, type: Object })
  async poll(
    @Param('enrollmentId', new ParseUUIDPipe()) enrollmentId: string,
    @Body() body: PollMachineEnrollmentRequestDto,
  ): Promise<PollMachineEnrollmentResponseDto> {
    return this.machineEnrollmentConfirmationService.poll(enrollmentId, body);
  }

  @Public()
  @Post(':enrollmentId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm machine enrollment locally' })
  @ApiResponse({ status: 200, type: Object })
  async confirm(
    @Param('enrollmentId', new ParseUUIDPipe()) enrollmentId: string,
    @Body() body: ConfirmMachineEnrollmentRequestDto,
  ): Promise<ConfirmMachineEnrollmentResponseDto> {
    return this.machineEnrollmentConfirmationService.confirm(
      enrollmentId,
      body,
    );
  }
}
