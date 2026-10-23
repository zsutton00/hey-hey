import { describe, expect, it } from 'vitest';
import type { AgenticSession } from '../../session/types';
import type {
  LocalHtmlCssMockupRevisionPromptPayload,
  LocalHtmlCssMockupRevisionAnnotation,
} from '../../shared/agent-bridge-contract/generated/api';
import type { PromptTypeHandlerContext } from '../prompt-type-handler';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { htmlCssMockupRevisionHandler } from './html-css-mockup-revision.handler';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';

const annotation = (): LocalHtmlCssMockupRevisionAnnotation => ({
  id: ANNOTATION_ID,
  note: 'Increase contrast',
  category: 'issue',
  lifecycle: 'open',
  authoredProposalId: PROPOSAL_ID,
  authoredSizeKey: 'desktop',
  target: {
    type: 'element',
    nodeId: 'hero-title',
    renderedContext: {
      outerHtmlExcerpt: '<h1 data-hh-id="hero-title">Hello</h1>',
      bounds: { x: 12, y: 24, width: 300, height: 48 },
    },
  },
});

const payload = (): LocalHtmlCssMockupRevisionPromptPayload => ({
  payloadVersion: 1,
  section: {
    key: 'mockup',
    html: '<h1 data-hh-id="hero-title">Hello</h1>',
    css: 'h1 { color: #777; }',
    sizeKey: 'desktop',
    renderedSize: { width: 1440, height: 900 },
    materializedProposalId: PROPOSAL_ID,
  },
  annotations: [annotation()],
});

const run = (): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    entity: { entityType: 'TASK', entityId: TASK_ID },
  }) as unknown as AgenticSession;

const context = (overrides: Record<string, unknown> = {}): PromptTypeHandlerContext => ({
  recentUserReplies: [],
  triggerParentMessageId: null,
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    entity: {
      id: TASK_ID,
      type: 'STANDARD',
      sections: [
        {
          id: 'section-1',
          key: 'mockup',
          order: 0,
          materializedProposalId: PROPOSAL_ID,
          materializedMarkdown: JSON.stringify({
            html: '<h1 data-hh-id="hero-title">Hello</h1>',
            css: 'h1 { color: #777; }',
            sizeKey: 'desktop',
            annotations: [
              {
                ...annotation(),
                author: { type: 'human', userId: 'user-1' },
                target: { type: 'element', nodeId: 'hero-title' },
              },
            ],
          }),
        },
      ],
      ...overrides,
    } as never,
    context: {} as never,
  },
});

describe('htmlCssMockupRevisionHandler', () => {
  it('registers a fresh, one-turn proposal-authoring handler', () => {
    expect(htmlCssMockupRevisionHandler).toMatchObject({
      promptType: 'html_css_mockup_revision',
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      eligibleWorkItemTypeKeys: ['STANDARD'],
    });
    expect(htmlCssMockupRevisionHandler.additionalAllowedTools).toContain('edit_work_item');
  });

  it('accepts an exact current snapshot and enriches it with the focal task identity', async () => {
    const result = await htmlCssMockupRevisionHandler.prepare!(
      run(),
      payload(),
      createPromptTypeHandlerTestDeps(),
      context(),
    );
    expect(
      (result.payload as LocalHtmlCssMockupRevisionPromptPayload & { _taskId: string })._taskId,
    ).toBe(TASK_ID);
    expect(htmlCssMockupRevisionHandler.buildPrompt(result.payload)).toContain(
      'Call `edit_work_item` exactly once',
    );
  });

  it('rejects changed source or materialized provenance', async () => {
    const changedSource = payload();
    changedSource.section.html = '<h1>stale</h1>';
    await expect(
      htmlCssMockupRevisionHandler.prepare!(
        run(),
        changedSource,
        createPromptTypeHandlerTestDeps(),
        context(),
      ),
    ).rejects.toThrow(/source or materialized provenance changed/);

    const changedProvenance = payload();
    changedProvenance.section.materializedProposalId = '44444444-4444-4444-8444-444444444444';
    await expect(
      htmlCssMockupRevisionHandler.prepare!(
        run(),
        changedProvenance,
        createPromptTypeHandlerTestDeps(),
        context(),
      ),
    ).rejects.toThrow(/source or materialized provenance changed/);
  });

  it('rejects resolved, outdated, missing, and duplicate selections', async () => {
    const resolvedContext = context();
    const entity = resolvedContext.loadedEntityContext?.entity as never as {
      sections: Array<{ materializedMarkdown: string }>;
    };
    const document = JSON.parse(entity.sections[0]!.materializedMarkdown);
    document.annotations[0].lifecycle = 'resolved';
    entity.sections[0]!.materializedMarkdown = JSON.stringify(document);
    await expect(
      htmlCssMockupRevisionHandler.prepare!(
        run(),
        payload(),
        createPromptTypeHandlerTestDeps(),
        resolvedContext,
      ),
    ).rejects.toThrow(/no longer open/);

    const outdatedContext = context();
    const outdatedEntity = outdatedContext.loadedEntityContext?.entity as never as {
      sections: Array<{ materializedMarkdown: string }>;
    };
    const outdatedDocument = JSON.parse(outdatedEntity.sections[0]!.materializedMarkdown);
    outdatedDocument.annotations[0].authoredProposalId = '55555555-5555-4555-8555-555555555555';
    outdatedEntity.sections[0]!.materializedMarkdown = JSON.stringify(outdatedDocument);
    await expect(
      htmlCssMockupRevisionHandler.prepare!(
        run(),
        payload(),
        createPromptTypeHandlerTestDeps(),
        outdatedContext,
      ),
    ).rejects.toThrow(/no longer current/);

    const missing = payload();
    missing.annotations[0]!.id = '66666666-6666-4666-8666-666666666666';
    await expect(
      htmlCssMockupRevisionHandler.prepare!(
        run(),
        missing,
        createPromptTypeHandlerTestDeps(),
        context(),
      ),
    ).rejects.toThrow(/no longer exists/);

    const duplicate = payload();
    duplicate.annotations.push(annotation());
    await expect(
      htmlCssMockupRevisionHandler.prepare!(
        run(),
        duplicate,
        createPromptTypeHandlerTestDeps(),
        context(),
      ),
    ).rejects.toThrow(/selected twice/);
  });
});
