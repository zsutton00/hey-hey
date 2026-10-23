import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  PrivateBetaDisclosureAcceptanceInputDto,
  PrivateBetaDisclosureAcceptanceResponseDto,
  PrivateBetaDisclosureStatusDto,
} from '../generated';
import { PrivateBetaDisclosureService } from '../services/private-beta-disclosure.service';

@ApiTags('Private Beta Access')
@ApiBearerAuth()
@Controller('api/v1/private-beta/disclosure')
@UseGuards(JwtAuthGuard)
export class PrivateBetaDisclosureController {
  constructor(
    private readonly privateBetaDisclosureService: PrivateBetaDisclosureService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Read private-beta disclosure acceptance status',
    description:
      'Returns the publication-owned current Terms, Privacy, and Agent Bridge security requirements and the authenticated user/account audit records. Product entry must fail closed unless every current action is recorded.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Disclosure status.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication.',
  })
  getStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrivateBetaDisclosureStatusDto> {
    return this.privateBetaDisclosureService.getStatus(user);
  }

  @Post('acceptance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record one private-beta disclosure action',
    description:
      'Appends one immutable, versioned AGREED or ACKNOWLEDGED action. User identity, active account, and acceptedAt are always derived by the server; repeated submissions for the same document version are idempotent.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Acceptance recorded.' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid document or action.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The submitted document version is stale.',
  })
  submitAcceptance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: PrivateBetaDisclosureAcceptanceInputDto,
  ): Promise<PrivateBetaDisclosureAcceptanceResponseDto> {
    return this.privateBetaDisclosureService.submitAcceptance(user, input);
  }
}
