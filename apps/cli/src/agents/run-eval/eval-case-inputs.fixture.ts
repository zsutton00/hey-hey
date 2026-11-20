import type { EvalCaseInputs } from '@hey-hey/contracts/api/models';

/** Test builder: an Eval Case inputs object holding one text message. */
export const oneMessageInputs = (text: string): EvalCaseInputs => ({
  inputs: [{ kind: 'text_message', text }],
});
