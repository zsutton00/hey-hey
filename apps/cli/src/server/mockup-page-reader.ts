import { z } from 'zod';
import type { ApiRuntime } from '@hey-hey/ui-common/clients';

/** An HTML/CSS mockup as the platform holds it, laid out at one presentation size. */
export interface MockupSource {
  html: string;
  css: string;
  sizeKey: string;
  width: number;
  height: number;
  /**
   * The proposal whose materialized change produced the section's current
   * content; null for a proposal's proposed value, which is not materialized.
   */
  revision: string | null;
}

/** Which mockup to read: a work item's approved section, or a section as a proposal holds it. */
type MockupTarget =
  | { kind: 'workItem'; mockupId: string }
  | { kind: 'proposal'; proposalId: string; sectionKey: string };

type MockupLocation = MockupTarget & {
  organizationId: string;
  projectId: string;
  /** Requested presentation size; the section's own choice or the type default applies when omitted. */
  sizeKey: string | null;
};

export type MockupReadFailure = 'not_found' | 'invalid_size' | 'unreadable';

export class MockupReadError extends Error {
  public constructor(
    public readonly failure: MockupReadFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MockupReadError';
  }
}

export type MockupReader = (location: MockupLocation) => Promise<MockupSource>;

export type MockupReaderClients = Pick<
  ApiRuntime['clients'],
  'tasks' | 'workItemTypes' | 'proposals'
>;

type WorkItemTypeDefinition = NonNullable<
  Awaited<
    ReturnType<
      MockupReaderClients['workItemTypes']['organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyGet']
    >
  >['data']['data']
>['definition'];
type SectionDefinition = WorkItemTypeDefinition['sections'][number];

const HTML_CSS_SECTION_KIND = 'html/css';

const sectionContentSchema = z.object({
  html: z.string(),
  css: z.string(),
  sizeKey: z.string().optional(),
});

/** The part of a task create or update proposal that carries proposed sections. */
const taskProposalUpdatesSchema = z.object({
  type: z.string().optional(),
  sections: z.array(z.object({ key: z.string(), content: z.unknown() })).optional(),
});

const statusOf = (error: unknown): unknown =>
  (error as { response?: { status?: unknown } } | null)?.response?.status;

const platformRead = async <T>(read: () => Promise<T>, what: string): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    throw new MockupReadError(
      statusOf(error) === 404 ? 'not_found' : 'unreadable',
      `The ${what} could not be read from the platform.`,
      { cause: error },
    );
  }
};

const parseContent = (raw: unknown): z.infer<typeof sectionContentSchema> => {
  try {
    return sectionContentSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (error) {
    throw new MockupReadError('unreadable', 'The mockup content has an unexpected shape.', {
      cause: error,
    });
  }
};

const layOut = (
  definition: SectionDefinition,
  content: z.infer<typeof sectionContentSchema>,
  sizeKey: string | null,
  revision: string | null,
): MockupSource => {
  const profiles = definition.sizeProfiles ?? [];
  const wanted = sizeKey ?? content.sizeKey ?? definition.defaultSizeKey;
  const profile = profiles.find((candidate) => candidate.key === wanted);
  // The widest breakpoint's page dimensions: a standalone page has no container to measure.
  const breakpoint = profile?.breakpoints.reduce((widest, candidate) =>
    candidate.minContainerWidth > widest.minContainerWidth ? candidate : widest,
  );
  if (!profile || !breakpoint) {
    throw new MockupReadError('invalid_size', 'The mockup has no such presentation size.');
  }
  return {
    html: content.html,
    css: content.css,
    sizeKey: profile.key,
    width: breakpoint.page.width,
    height: breakpoint.page.height,
    revision,
  };
};

/**
 * Reads the mockup's content, revision and size dimensions with the CLI's own
 * platform credentials; the platform decides whether this user may see it.
 * A proposal's mockup is read as the proposal holds it, before approval.
 */
export const createMockupReader = (clients: MockupReaderClients): MockupReader => {
  const readTask = async (organizationId: string, projectId: string, taskId: string) => {
    const task = (
      await platformRead(
        () =>
          clients.tasks.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
            organizationId,
            projectId,
            taskId,
          }),
        'mockup',
      )
    ).data.data;
    if (!task) throw new MockupReadError('not_found', 'The mockup was not found.');
    return task;
  };
  const readDefinition = async (organizationId: string, projectId: string, typeKey: string) => {
    const type = (
      await platformRead(
        () =>
          clients.workItemTypes.organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyGet(
            { organizationId, projectId, typeKey },
          ),
        'mockup type',
      )
    ).data.data;
    if (!type) throw new MockupReadError('unreadable', 'The mockup type could not be read.');
    return type.definition;
  };

  return async (location) => {
    const { organizationId, projectId, sizeKey } = location;
    if (location.kind === 'workItem') {
      const task = await readTask(organizationId, projectId, location.mockupId);
      const definition = (await readDefinition(organizationId, projectId, task.type)).sections.find(
        (section) => section.kind === HTML_CSS_SECTION_KIND,
      );
      if (!definition) throw new MockupReadError('unreadable', 'The item has no HTML/CSS section.');
      const section = task.sections?.find((candidate) => candidate.key === definition.key);
      if (!section) throw new MockupReadError('unreadable', 'The mockup has no content yet.');
      return layOut(
        definition,
        parseContent(section.materializedMarkdown),
        sizeKey,
        section.materializedProposalId,
      );
    }

    const proposal = (
      await platformRead(
        () =>
          clients.proposals.getProposal({
            organizationId,
            projectId,
            proposalId: location.proposalId,
          }),
        'proposal',
      )
    ).data.data;
    if (!proposal) throw new MockupReadError('not_found', 'The proposal was not found.');
    const updates = taskProposalUpdatesSchema.safeParse(proposal.updates);
    const proposed = updates.success
      ? updates.data.sections?.find((candidate) => candidate.key === location.sectionKey)
      : undefined;
    if (proposal.targetEntityType !== 'TASK' || !proposed) {
      throw new MockupReadError('not_found', 'The proposal does not propose this mockup.');
    }
    // An update proposal that keeps the item's type names none; the item's own type applies.
    const typeKey =
      updates.data?.type ??
      (await readTask(organizationId, projectId, proposal.targetEntityId)).type;
    const definition = (await readDefinition(organizationId, projectId, typeKey)).sections.find(
      (section) => section.key === location.sectionKey,
    );
    if (definition?.kind !== HTML_CSS_SECTION_KIND) {
      throw new MockupReadError('unreadable', 'The proposed section is not an HTML/CSS mockup.');
    }
    return layOut(definition, parseContent(proposed.content), sizeKey, null);
  };
};
