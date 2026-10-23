import { AdmittedHostAction } from './types';

class TestAdmittedHostAction extends AdmittedHostAction {
  public constructor() {
    super('CONVERSATION_TRIGGER', 'test-authorization', 'test-envelope');
  }
}

/** Test-only proof for exercising effect owners below the admission boundary. */
export const TEST_ADMITTED_HOST_ACTION = new TestAdmittedHostAction();
