import { describe, expect, it } from 'vitest';
import { ProjectMaturity } from '../../shared/api/index';
import { buildPlatformSystemPrompt } from './common';
import workItemTypesFixture from './__fixtures__/work-item-types.fixture';

const builtInTypes = workItemTypesFixture.map((summary) => summary.definition);

describe('platform system prompt', () => {
  it('matches the captured text', () => {
    const prompt = buildPlatformSystemPrompt(builtInTypes, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      epistemicCalibration: true,
    });
    const continuityDuty =
      'Because future agents do not inherit the current conversation, preserve its material conclusions, next steps and any operational state you leave behind in authored entities, not in repository markdown files the graph cannot see.';

    expect(prompt).toContain('When your next action may create or change project topology');
    expect(prompt).toContain('call get_authoring_guidance() once before the mutation.');
    expect(prompt).toContain(
      'Carry its reusable authoringRootProof into the specific authoring-guidance read',
    );
    expect(prompt).toContain('The detailed mutation rules live in get_authoring_guidance()');
    expect(prompt.match(/\*\*Contextual type guidance is read on demand\.\*\*/gu)).toHaveLength(1);
    expect(prompt).toContain('`get_work_item_type_guidance_batch`');
    expect(prompt).not.toContain('`get_work_item_type_guidance`');
    expect(prompt).toContain('`get_work_item_type_guidance_batch`');
    expect(prompt).toContain('typeKeys: [key]');
    expect(prompt).toContain('deduplicated array of 1–10 relevant encountered keys');
    expect(prompt).toContain('same purpose and relevant focal context');
    expect(prompt).toContain('request order');
    expect(prompt).toContain('Never speculate across or fan out over the catalog');
    expect(prompt).toContain('purpose: "semantic"');
    expect(prompt).toContain(
      'include `focalTypeKey` only for semantic reads where contextual interpretation matters',
    );
    expect(prompt).not.toContain('Use for implementation work.');
    expect(prompt).not.toContain('## Grouped Proposal Authoring');
    expect(prompt).toContain('## Contract Discovery and Enforcement');
    expect(prompt).not.toContain('## Workflow Links');
    expect(prompt).toContain('**Diagram** (`DIAGRAM`)');
    expect(prompt).toContain('**Diagram Element** (`DIAGRAM_ELEMENT`)');
    // Diagram authoring and read rules live in the API's DIAGRAM type and
    // get_diagram guidance, not in the shared prompt.
    expect(prompt).not.toContain('## Native diagrams');
    expect(prompt).not.toContain('Mermaid');
    expect(prompt).not.toContain('For Diagram aggregate reads');
    expect(prompt).not.toContain('workflow_step');
    expect(prompt).not.toContain('**Workflow**');
    expect(prompt).toContain(
      'Assume the user may have product, domain, or runtime evidence you lack.',
    );
    expect(prompt).not.toMatch(/initiative/i);
    expect(prompt.split(continuityDuty)).toHaveLength(2);
    expect(
      prompt.split(
        'Relevant sessions are also graph evidence: use them to clarify gaps in recorded intent or progress, while treating authored requirements as authoritative.',
      ),
    ).toHaveLength(2);
    expect(prompt).toMatchSnapshot();
  });

  it('matches the stored snapshot with Intent-first on', () => {
    expect(
      buildPlatformSystemPrompt(builtInTypes, undefined, {
        intentFirst: true,
        maturity: ProjectMaturity.Established,
        hints: 'none',
      }),
    ).toMatchSnapshot();
  });

  it('excludes archived references from usable context', () => {
    const prompt = buildPlatformSystemPrompt(builtInTypes);

    expect(prompt).toContain('Treat every entity with status `ARCHIVED` as absent');
    expect(prompt).toContain(
      'This applies even when an archived entity appears in quoted text, conversation history, reports, mentions, retrieved topology, or any other indirect context.',
    );
  });
});
