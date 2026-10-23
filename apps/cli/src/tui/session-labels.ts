/**
 * Labels for one session, read from the assembled session snapshot and its
 * metadata. A missing title is reported as missing — never replaced by the
 * focal entity's name — and every state reads correctly without color.
 */

import type { AgentSessionCurrentState } from '../shared/api/generated/api';
import type {
  LocalSessionMetadata,
  LocalSessionMetadataUnavailableReason,
} from '../server/local-session-metadata-source';
import type { LocalSessionSnapshot } from '../server/local-session-read-source';
import { formatDuration, type Tone } from './text';

const STATE_LABEL: Record<AgentSessionCurrentState, string> = {
  IDLE: 'Idle',
  STARTING: 'Starting',
  GATHERING_CONTEXT: 'Gathering context',
  THINKING: 'Thinking',
  WRITING: 'Writing',
  AWAITING_APPROVAL: 'Awaiting approval',
  PLAN_READY: 'Plan ready',
  IMPLEMENTATION_READY: 'Implementation ready',
};

const STATE_TONE: Record<AgentSessionCurrentState, Tone> = {
  IDLE: 'muted',
  STARTING: 'accent',
  GATHERING_CONTEXT: 'accent',
  THINKING: 'accent',
  WRITING: 'accent',
  AWAITING_APPROVAL: 'warning',
  PLAN_READY: 'success',
  IMPLEMENTATION_READY: 'success',
};

const UNAVAILABLE_SUFFIX: Record<LocalSessionMetadataUnavailableReason, string> = {
  no_focal_entity: '',
  context_not_loaded: 'not loaded',
  signed_out: 'signed out',
  unauthorized: 'not authorized',
  read_failed: 'could not be read',
};

export interface StateLabel {
  readonly text: string;
  readonly tone: Tone;
}

/** The single effective state, with how long the session has been in it. Idle carries no duration. */
export const sessionStateLabel = (session: LocalSessionSnapshot, nowMs: number): StateLabel => {
  const effective = session.effectiveState;
  if (effective === null) return { text: 'State pending', tone: 'muted' };
  const label = STATE_LABEL[effective.state];
  const tone = STATE_TONE[effective.state];
  if (effective.state === 'IDLE') return { text: label, tone };
  const since = Date.parse(effective.observedAt);
  if (Number.isNaN(since)) return { text: label, tone };
  return { text: `${label} for ${formatDuration(nowMs - since)}`, tone };
};

export const sessionTitle = (metadata: LocalSessionMetadata | undefined): StateLabel => {
  const title = metadata?.title ?? { status: 'unloaded' as const };
  switch (title.status) {
    case 'unloaded':
    case 'loading':
      return { text: 'Loading title…', tone: 'muted' };
    case 'available':
      return title.value === null
        ? { text: 'Untitled conversation', tone: 'muted' }
        : { text: title.value, tone: 'normal' };
    case 'stale':
      return {
        text: `${title.value ?? 'Untitled conversation'} (may be out of date)`,
        tone: 'normal',
      };
    case 'unavailable':
      return { text: `Title unavailable (${UNAVAILABLE_SUFFIX[title.reason]})`, tone: 'muted' };
  }
};

/** Feature ancestry root first, then the focal entity, or an explicit loading/unavailable note. Null when the session has no focal entity. */
export const sessionContextPath = (metadata: LocalSessionMetadata | undefined): string | null => {
  const context = metadata?.focalContext ?? { status: 'unloaded' as const };
  switch (context.status) {
    case 'unloaded':
    case 'loading':
      return 'Loading context…';
    case 'available':
    case 'stale': {
      const entity = context.value.entity;
      const entityName = 'name' in entity ? entity.name : entity.title;
      return [...context.value.featureAncestry]
        .reverse()
        .map((feature) => feature.name)
        .concat(entityName)
        .join(' / ');
    }
    case 'unavailable':
      return context.reason === 'no_focal_entity'
        ? null
        : `Context ${UNAVAILABLE_SUFFIX[context.reason]}`;
  }
};

export const providerLabel = (provider: string): string => {
  switch (provider) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'opencode':
      return 'OpenCode';
    default:
      return provider;
  }
};
