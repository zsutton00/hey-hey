import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  HelpAssetNotFoundError,
  HelpAssetPathError,
  HelpAssetService,
} from '../../services/help-asset.service';
import { HelpService } from '../../services/help.service';
import { HelpController } from '../help.controller';

describe('HelpController', () => {
  let controller: HelpController;
  const helpService = {
    getTree: jest.fn(),
    searchHelpNodes: jest.fn(),
    findByIdOrSlugPath: jest.fn(),
  };
  const helpAssetService = {
    readAsset: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new HelpController(
      helpService as unknown as HelpService,
      helpAssetService as unknown as HelpAssetService,
    );
  });

  it('returns repository-managed Help assets as raw bytes', async () => {
    helpAssetService.readAsset.mockResolvedValue({
      body: Buffer.from('image bytes'),
      mediaType: 'image/png',
    });

    const response = await controller.getAsset(['nested', 'diagram.png']);

    expect(helpAssetService.readAsset).toHaveBeenCalledWith(
      'nested/diagram.png',
    );
    expect(response.getHeaders()).toEqual({
      type: 'image/png',
      length: Buffer.byteLength('image bytes'),
    });
  });

  it('maps unsafe asset paths to a deterministic bad request', async () => {
    helpAssetService.readAsset.mockRejectedValue(
      new HelpAssetPathError('unsafe path'),
    );

    await expect(controller.getAsset('../secret.png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps missing assets to a deterministic not found', async () => {
    helpAssetService.readAsset.mockRejectedValue(
      new HelpAssetNotFoundError('missing asset'),
    );

    await expect(controller.getAsset('missing.png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delegates multi-segment node paths to the help service', async () => {
    const node = {
      id: '33333333-3333-4333-8333-333333333333',
      parentId: '22222222-2222-4222-8222-222222222222',
      slug: 'child',
      title: 'Child',
      ordering: 1,
      body: 'Child body',
      demos: [],
    };
    helpService.findByIdOrSlugPath.mockResolvedValue(node);

    await expect(controller.getNode(['root', 'child'])).resolves.toEqual(node);

    expect(helpService.findByIdOrSlugPath).toHaveBeenCalledWith('root/child');
  });

  it('delegates help search query params to the help service', async () => {
    const response = {
      results: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'topic',
          title: 'Topic',
          snippet: 'Matched topic',
          rank: 0.7,
        },
      ],
    };
    helpService.searchHelpNodes.mockResolvedValue(response);

    await expect(controller.search('topic', '25')).resolves.toEqual(response);

    expect(helpService.searchHelpNodes).toHaveBeenCalledWith('topic', 25);
  });

  it('uses the OpenAPI default maxResults for help search', async () => {
    const response = { results: [] };
    helpService.searchHelpNodes.mockResolvedValue(response);

    await expect(controller.search('topic', undefined)).resolves.toEqual(
      response,
    );

    expect(helpService.searchHelpNodes).toHaveBeenCalledWith('topic', 10);
  });

  it('rejects help search when q is missing', async () => {
    await expect(
      controller.search(undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(helpService.searchHelpNodes).not.toHaveBeenCalled();
  });

  it('rejects help search when maxResults is outside the OpenAPI bounds', async () => {
    await expect(controller.search('topic', '101')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(helpService.searchHelpNodes).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the service does not resolve a node', async () => {
    helpService.findByIdOrSlugPath.mockResolvedValue(null);

    await expect(controller.getNode('missing-topic')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
