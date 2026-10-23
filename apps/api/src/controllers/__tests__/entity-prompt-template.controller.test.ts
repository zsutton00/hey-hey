import { EntityPromptTemplateController } from '../entity-prompt-template.controller';
import { OrganizationId, ProjectId } from '../../types';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;

describe('EntityPromptTemplateController', () => {
  it('delegates catalog and effective-template reads with route scope', async () => {
    const service = {
      getProjectCatalog: jest.fn().mockResolvedValue({ templates: [] }),
      getEffectiveTemplate: jest.fn().mockResolvedValue({
        templateKey: 'entity_context',
      }),
    };
    const subject = new EntityPromptTemplateController(service as never);

    await expect(
      subject.getProjectCatalog(organizationId, projectId),
    ).resolves.toEqual({ templates: [] });
    await expect(
      subject.getEffectiveTemplate(organizationId, projectId, 'entity_context'),
    ).resolves.toEqual({ templateKey: 'entity_context' });

    expect(service.getProjectCatalog).toHaveBeenCalledWith(
      organizationId,
      projectId,
    );
    expect(service.getEffectiveTemplate).toHaveBeenCalledWith(
      organizationId,
      projectId,
      'entity_context',
    );
  });
});

it('passes the exact draft and authenticated scope to validation and rejects malformed requests', async () => {
  const service = {
    validateDraft: jest.fn().mockResolvedValue({ status: 'VALID', issues: [] }),
  };
  const subject = new EntityPromptTemplateController(service as never);
  const request = {
    selector: { entityType: 'PROJECT' },
    syntaxVersion: 'V1',
    content: '\r\n{{ entity.name }}\t',
  };
  await subject.validateDraft(
    organizationId,
    projectId,
    'entity_context.project',
    request,
  );
  expect(service.validateDraft).toHaveBeenCalledWith(
    organizationId,
    projectId,
    'entity_context.project',
    request,
  );
  expect(() =>
    subject.validateDraft(organizationId, projectId, 'entity_context.project', {
      ...request,
      content: 7,
    }),
  ).toThrow('Invalid template draft');
});
