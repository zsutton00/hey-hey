import { log as temporalLog, proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// Use both temporal and console logging for debugging
export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[DEBUG] ${msg}`, data || '');
    temporalLog.debug(msg, data);
  },
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[INFO] ${msg}`, data || '');
    temporalLog.info(msg, data);
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(`[WARN] ${msg}`, data || '');
    temporalLog.warn(msg, data);
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(`[ERROR] ${msg}`, data || '');
    temporalLog.error(msg, data);
  },
};

// Activity configuration
const activityOptions = {
  startToCloseTimeout: 120000, // Increased to 2 minutes for LLM routing calls
  retry: {
    maximumAttempts: 1, // No retries to allow error handling tests to work
  },
};

export const {
  initializeConversationFlow,
  executeFlowNode,
  generateNodeContent,
  processNodeUserResponseHook,
  processNodeResponse,
  nodeNeedsTwoPhaseExecution,
  createSystemMessage,
  saveFlowState,
  pauseFlow,
  completeFlow,
  getNodeInfo,
} = proxyActivities<typeof activities>(activityOptions);
