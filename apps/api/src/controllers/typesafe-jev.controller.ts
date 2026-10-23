import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  JevChoiceEvaluationRequestDto,
  JevChoiceEvaluationResponseDto,
} from '../generated';
import { TypeSafeJevService } from '../services/typesafe-jev/typesafe-jev.service';

@ApiTags('Jev')
@Controller('api/v1/jev')
export class TypeSafeJevController {
  constructor(private readonly typeSafeJevService: TypeSafeJevService) {}

  @Post('evaluate-choice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate a TypeSafe Jev choice',
    description:
      'Evaluates one named-choice question with the server-side TypeSafe Jev client.',
  })
  async evaluateChoice(
    @Body() input: JevChoiceEvaluationRequestDto,
  ): Promise<JevChoiceEvaluationResponseDto> {
    return this.typeSafeJevService.evaluateChoice({
      state: input.state,
      question: input.question,
      criteria: input.criteria,
    });
  }
}
