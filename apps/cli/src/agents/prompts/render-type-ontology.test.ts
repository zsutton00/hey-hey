import { describe, expect, it } from 'vitest';

import { WorkStatus } from '../../shared/api/generated/api';
import type { WorkItemTypeDefinitionDto } from '../../shared/api/index';
import { FeatureTag } from '../../shared/agent-bridge-contract/generated/api';
import {
  renderFeatureTagList,
  renderFeatureTagVocabulary,
  isPlatformFeatureType,
  renderWorkItemTypeOntologyEntry,
} from './render-type-ontology';

const BASE: Pick<WorkItemTypeDefinitionDto, 'sections' | 'allowedStatuses'> = {
  sections: [],
  allowedStatuses: [WorkStatus.Active],
};

describe('renderWorkItemTypeOntologyEntry', () => {
  it('renders the compact name, key, and description even when additional axes are declared', () => {
    const def: WorkItemTypeDefinitionDto = {
      ...BASE,
      key: 'CONTRACT',
      name: 'Contract',
      role: 'project-info',
      description: 'Legal agreements and SLAs.',
      allowedParentTypes: ['FEATURE'],
      allowedParentEntityTypes: ['TASK'],
      requiredScalars: ['dueDate'],
      edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: ['CONTRACT', 'STANDARD'] }],
    };
    const result = renderWorkItemTypeOntologyEntry(def);
    expect(result).toContain('Contract');
    expect(result).toContain('`CONTRACT`');
    expect(result).toContain('Legal agreements and SLAs');
    expect(result).not.toContain('Parent types');
    expect(result).not.toContain('Child types');
    expect(result).not.toContain('Required fields');
    expect(result).not.toContain('Edges');
  });

  it('renders a minimal entry for a thin definition (key and name only)', () => {
    const def: WorkItemTypeDefinitionDto = {
      ...BASE,
      key: 'MARKETING',
      name: 'Marketing',
      role: 'work-item',
    };
    const result = renderWorkItemTypeOntologyEntry(def);
    expect(result).toContain('Marketing');
    expect(result).toContain('`MARKETING`');
    // No invented parentage, hierarchy, scalars, or edges
    expect(result).not.toContain('Parent types');
    expect(result).not.toContain('Child types');
    expect(result).not.toContain('feature hierarchy');
    expect(result).not.toContain('Required fields');
    expect(result).not.toContain('Edges');
  });

  it('renders a GOAL-shaped definition as top-level', () => {
    const def: WorkItemTypeDefinitionDto = {
      ...BASE,
      key: 'GOAL',
      name: 'Goal',
      role: 'project-info',
      description: 'A high-level outcome the project pursues.',
      allowedParentTypes: [],
    };
    const result = renderWorkItemTypeOntologyEntry(def);
    expect(result).toContain('Goal');
    expect(result).toContain('`GOAL`');
    expect(result).toContain('A high-level outcome');
    expect(result).toContain('Top-level only');
    expect(result).not.toContain('No children');
    expect(result).not.toContain('feature hierarchy');
  });

  it('omits non-empty parent and edge axes for a sparse Contract-shaped definition', () => {
    const def: WorkItemTypeDefinitionDto = {
      ...BASE,
      key: 'CONTRACT',
      name: 'Contract',
      role: 'project-info',
      description: 'Tracks legal agreements.',
      allowedParentTypes: ['FEATURE'],
      edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: [] }],
    };
    const result = renderWorkItemTypeOntologyEntry(def);
    expect(result).toContain('Contract');
    expect(result).not.toContain('FEATURE');
    expect(result).not.toContain('RELATED_TO');
    expect(result).not.toContain('any type');
    // No invented child types or scalars
    expect(result).not.toContain('Child types');
    expect(result).not.toContain('Required fields');
    expect(result).not.toContain('feature hierarchy');
  });

  it('does not render feature hierarchy participation in compact entries', () => {
    const def: WorkItemTypeDefinitionDto = {
      ...BASE,
      key: 'FEATURE',
      name: 'Feature',
      role: 'project-info',
      description: 'A product concept.',
    };
    const result = renderWorkItemTypeOntologyEntry(def);
    expect(result).not.toContain('feature hierarchy');
  });

  it('does not render edge targets in compact entries', () => {
    const def: WorkItemTypeDefinitionDto = {
      ...BASE,
      key: 'BUG',
      name: 'Bug',
      role: 'work-item',
      edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: [] }],
    };
    const result = renderWorkItemTypeOntologyEntry(def);
    expect(result).not.toContain('RELATED_TO → any type');
  });
});

describe('isPlatformFeatureType', () => {
  it('uses the platform-owned FEATURE key rather than an authorable capability', () => {
    expect(
      isPlatformFeatureType({
        ...BASE,
        key: 'FEATURE',
        name: 'Feature',
        role: 'project-info',
      }),
    ).toBe(true);
    expect(
      isPlatformFeatureType({
        ...BASE,
        key: 'CUSTOM',
        name: 'Custom',
        role: 'work-item',
      }),
    ).toBe(false);
  });
});

describe('renderFeatureTagList', () => {
  it('contains exactly the FeatureTag enum values as backtick-quoted tokens', () => {
    const result = renderFeatureTagList();
    for (const tag of Object.values(FeatureTag)) {
      expect(result).toContain(`\`${tag}\``);
    }
  });

  it('is derived — equals Object.values(FeatureTag) mapped to backtick tokens, so it changes if the enum changes', () => {
    const expected = Object.values(FeatureTag)
      .map((tag) => `\`${tag}\``)
      .join(', ');
    expect(renderFeatureTagList()).toBe(expected);
  });
});

describe('renderFeatureTagVocabulary', () => {
  it('contains all FeatureTag enum values', () => {
    const result = renderFeatureTagVocabulary();
    for (const tag of Object.values(FeatureTag)) {
      expect(result).toContain(`\`${tag}\``);
    }
  });

  it('includes the AI gloss', () => {
    expect(renderFeatureTagVocabulary()).toContain('AI/agent-shaped delivery');
  });

  it('includes the product-default note', () => {
    expect(renderFeatureTagVocabulary()).toContain('`product` is the default');
  });
});
