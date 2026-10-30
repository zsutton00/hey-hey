import { describe, expect, it } from 'vitest';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  buildRepositoryAnalysisPrompt,
  type RepositoryAnalysisPromptInput,
} from './repository-analysis-prompt';
import type { RepositoryAnalysisBounds } from './types';
import { parseRepositoryAnalysisCompletion } from './schemas';

const bounds: RepositoryAnalysisBounds = {
  maxFiles: 4,
  maxTotalBytes: 256,
  maxFileBytes: 128,
  maxDepth: 2,
  maxGeneratedFiles: 4,
  maxIgnoredFiles: 4,
  maxUnsupportedFiles: 4,
  maxBinaryFiles: 4,
};

const request = {
  promptType: LocalPromptType.RepositoryGrounding,
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  workflowId: '33333333-3333-4333-8333-333333333333',
  workflowNodeId: 'repository-grounding-node',
  entryMode: 'existing_project' as const,
  serviceId: '44444444-4444-4444-8444-444444444444',
  confirmedServiceBrief: 'Account management for project customers.',
  machineId: '55555555-5555-4555-8555-555555555555',
  scope: {
    scope: 'focused' as const,
    focus: 'Account settings and customer-facing account flows',
  },
  provider: 'claude',
  resolvedFrontierModel: 'frontier-model',
  reasoningEffort: 'high' as const,
  bounds,
};

const analysisInput: RepositoryAnalysisPromptInput = {
  ...request,
  provider: 'claude',
  model: 'frontier-model',
};

describe('repository-grounding prompts', () => {
  it('locks the concise adaptive research prompt', () => {
    expect(buildRepositoryAnalysisPrompt(analysisInput)).toMatchSnapshot();
  });

  it('keeps startup size independent of repository contents', () => {
    const prompt = buildRepositoryAnalysisPrompt(analysisInput);
    expect(prompt).not.toContain('BEGIN FILE');
    expect(prompt).not.toContain('README.md');
    expect(prompt).toContain('targeted searches and selective file reads');
    expect(prompt).toContain('If delegation is unavailable or disabled');
    expect(prompt).toContain('distinct coherence challenge');
    expect(prompt).toContain('execution controls, not output fields');
  });

  it('renders generated-type-checked examples for every completion branch and nested shape', () => {
    const prompt = buildRepositoryAnalysisPrompt(analysisInput);
    const examples: unknown[] = [...prompt.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(
      (match) => JSON.parse(match[1] ?? '') as unknown,
    );

    expect(examples).toHaveLength(3);
    for (const example of examples) {
      expect(parseRepositoryAnalysisCompletion(example)).toMatchObject({ ok: true });
    }
    expect(examples[0]).toMatchObject({
      serviceId: request.serviceId,
      provider: request.provider,
      resolvedFrontierModel: request.resolvedFrontierModel,
      hierarchy: { topLevels: [{ children: [{ tag: 'frontend' }, { tag: 'backend' }] }] },
      evidence: [{ lineStart: 10, lineEnd: 24 }],
      briefDiscrepancies: [
        {
          summary: 'The repository supports fewer account roles than the brief states.',
          material: true,
          evidencePaths: ['path/to/evidence.ts'],
        },
      ],
    });
    expect(prompt).toContain(
      'machine_unavailable, directory_unresolved, provider_unavailable, provider_timeout, rate_limited, transient_read_failure',
    );
    expect(prompt).toContain(
      'invalid_request, unsupported_scope, unsupported_provider, unsupported_model, access_denied, invalid_completion',
    );
    expect(prompt).toContain(
      'briefDiscrepancies with summary, rationale, material=true, and repository-relative evidencePaths when available',
    );
    expect(prompt).not.toContain('coherenceChanges');
    expect(prompt).not.toContain('"omissions"');
    expect(prompt).not.toContain('"confidence"');
    expect(prompt).not.toContain('with uncertainty');
    expect(prompt).toContain('The three outcome branches are mutually exclusive.');
  });

  it('teaches discovery before description and shows multi-sentence example descriptions', () => {
    const prompt = buildRepositoryAnalysisPrompt(analysisInput);
    expect(prompt).toContain('Discovering what a capability is and does');
    expect(prompt).toContain('entry points');
    expect(prompt).toContain('outcomes they produce');
    expect(prompt).toContain('boundaries the code enforces');
    expect(prompt).toContain('neighboring capabilities');
    expect(prompt).toContain('never requirements or claimed intent');

    const success = JSON.parse(/```json\n([\s\S]*?)\n```/u.exec(prompt)?.[1] ?? '') as {
      hierarchy: { topLevels: { description: string; children: { description: string }[] }[] };
    };
    const descriptions = success.hierarchy.topLevels.flatMap((top) => [
      top.description,
      ...top.children.map((child) => child.description),
    ]);
    for (const description of descriptions) {
      expect(description.split(/(?<=[.!?])\s+/u).length).toBeGreaterThan(1);
    }
  });
});
