import { makeRepositoryImportContext } from './repository-import-context.fixture';
import { RepositoryFeatureEnrichmentNode } from '../repository-feature-enrichment.node';
import { RepositoryImportEnrichmentChoiceNode } from '../../repository-import/repository-import-enrichment-choice.node';
import { repositoryImportFlow } from '../../../templates/repository-import.flow';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { NodeType } from '../../../../types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../../constants';
import { RepositoryFeatureEnrichmentChoice } from '../../../../generated';
import { createOpenApiRuntimeSchema } from '../../shared/openapi-runtime-schema';

describe('Repository enrichment handoff', () => {
  it('finishes the workflow with a single contract-valid trigger carrying created Features, evidence, and runtime', async () => {
    const state = makeRepositoryImportContext();
    const tracker = createMutableContextHandle(state);
    const node = new RepositoryFeatureEnrichmentNode();
    const result = await node.execute(tracker);
    expect(node.type).toBe(NodeType.FINALIZE);
    expect(result.uiElements).toBeUndefined();
    if (!result.triggersAgent || !('payload' in result.triggersAgent))
      throw new Error('Missing handoff');
    expect(result.triggersAgent.payload).toMatchObject({
      materializedFeatureIds: state.repositoryImportMaterializedFeatureIds,
      analysis: state.repositoryGroundingBaseline,
      reasoningEffort: 'high',
      fastMode: true,
    });
    expect(
      createOpenApiRuntimeSchema(
        'RepositoryFeatureEnrichmentRequest',
      ).safeParse(result.triggersAgent.payload).success,
    ).toBe(true);
    expect(result.triggersAgent.payload).not.toHaveProperty('answerBatches');
    expect(result.triggersAgent.payload).not.toHaveProperty('completedRounds');
    expect(node).not.toHaveProperty('processUserResponse');
  });

  it('offers Done or Ask more questions only after Features are created', async () => {
    const node = new RepositoryImportEnrichmentChoiceNode();
    const tracker = createMutableContextHandle(makeRepositoryImportContext());
    const result = await node.execute(tracker);
    expect(result.uiElements?.[0]).toMatchObject({
      options: [
        { value: 'ENRICH', label: 'Ask more questions' },
        { value: 'SKIP', label: 'Done' },
      ],
    });
    await expect(
      node.determineRoutingFromUserMessage({
        ...tracker.getContext(),
        repositoryFeatureEnrichmentChoice:
          RepositoryFeatureEnrichmentChoice.Skip,
      }),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.END);
    await expect(
      node.determineRoutingFromUserMessage({
        ...tracker.getContext(),
        repositoryFeatureEnrichmentChoice:
          RepositoryFeatureEnrichmentChoice.Enrich,
      }),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.ENRICHMENT);
    tracker.mutate((draft) => {
      draft.repositoryImportMaterializedFeatureIds = undefined;
    });
    await expect(node.execute(tracker)).rejects.toThrow('created Features');
    await expect(
      new RepositoryFeatureEnrichmentNode().execute(tracker),
    ).rejects.toThrow('created Features');
  });

  it('never routes enrichment back through generation or an API question loop', () => {
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.ENRICHMENT],
    ).toEqual({});
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.FINALIZE]!.nextNode,
    ).toBe(REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE);
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.GENERATE_FEATURES]!
        .nextNode,
    ).toBe(REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY);
    expect(repositoryImportFlow.nodes).not.toHaveProperty(
      REPOSITORY_IMPORT_NODES.ENRICHMENT_QUESTIONS,
    );
  });
});
