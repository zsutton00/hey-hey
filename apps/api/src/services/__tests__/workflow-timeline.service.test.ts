import * as fs from 'fs';
import * as path from 'path';

import { WorkflowTimelineService } from '../workflow-timeline.service';

describe('WorkflowTimelineService', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures', 'test_workflow.logs');

  it('builds a timeline with node coverage from the workflow log fixture', () => {
    const logContents = fs.readFileSync(fixturePath, 'utf8').trim();
    const logLines = logContents.split(/\n/).filter(Boolean);

    const service = new WorkflowTimelineService({} as any);
    const timeline = service.buildTimelineFromLogs(
      logLines,
      '44380603-dbcc-448f-9c4e-9355ba41e562',
    );

    expect(timeline.stats.totalEntries).toBeGreaterThan(0);
    expect(timeline.stats.assignedEntries).toBeGreaterThan(0);
    expect(timeline.stats.assignedEntries).toBeGreaterThan(
      timeline.stats.orphanedEntries,
    );

    const nodeIds = timeline.nodes.map((node) => node.name);
    expect(nodeIds).toEqual(
      expect.arrayContaining([
        'onboarding-welcome',
        'onboarding-clarify-concept',
      ]),
    );

    const welcomeNode = timeline.nodes.find(
      (node) => node.name === 'onboarding-welcome',
    );
    expect(welcomeNode).toBeDefined();
    if (!welcomeNode) {
      throw new Error('Expected welcome node');
    }
    expect(welcomeNode.steps.length).toBeGreaterThan(0);
    expect(welcomeNode.steps[0]?.events.length).toBeGreaterThan(0);
    expect(welcomeNode.events.length).toBeGreaterThan(0);
  });

  it('cleans contextual metadata, avoids non-temporal steps, and tracks severity', () => {
    const logContents = fs.readFileSync(fixturePath, 'utf8').trim();
    const logLines = logContents.split(/\n/).filter(Boolean);

    const service = new WorkflowTimelineService({} as any);
    const timeline = service.buildTimelineFromLogs(
      logLines,
      '44380603-dbcc-448f-9c4e-9355ba41e562',
    );

    const allSteps = timeline.nodes.flatMap((node) => node.steps);
    const nonTemporalStepNames = allSteps.map((step) => step.name);
    expect(nonTemporalStepNames).not.toContain('FlowEngineService');
    expect(nonTemporalStepNames).not.toContain('Temporal');

    const allEvents = timeline.nodes.flatMap((node) => node.events);
    const processorEvent = allEvents.find(
      (event) =>
        event.message === 'System message created - no processing needed',
    );

    expect(processorEvent).toBeDefined();
    if (!processorEvent) {
      throw new Error('Expected processor event');
    }
    expect(processorEvent.metadata.nodeId).toBe('onboarding-clarify-concept');
    expect(processorEvent.level).toBe('DEBUG');
    expect(processorEvent.severityRank).toBe(4);
  });
});
