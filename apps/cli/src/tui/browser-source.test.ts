import { describe, expect, it, vi } from 'vitest';
import { SharedBrowserSource } from './browser-source';
import { ControlledBrowserManager } from './presentation.test-support';

describe('SharedBrowserSource', () => {
  it('reads the setting, then tracks each project the manager reports in first-seen order', async () => {
    const manager = new ControlledBrowserManager();
    manager.enabled = false;
    const source = new SharedBrowserSource(manager, () => Promise.resolve(null), vi.fn());
    const observer = vi.fn();
    const observation = source.observe(observer);
    expect(observation.snapshot).toEqual({ enabled: null, projects: [] });

    await vi.waitFor(() =>
      expect(observer).toHaveBeenLastCalledWith({ enabled: false, projects: [] }),
    );
    await manager.setEnabled(true);
    manager.launch('project-b');
    manager.launch('project-a');
    await manager.close('project-b');
    expect(observer).toHaveBeenLastCalledWith({
      enabled: true,
      projects: [
        { projectId: 'project-b', name: null, status: 'stopped' },
        { projectId: 'project-a', name: null, status: 'running' },
      ],
    });
  });

  it('delegates close and setEnabled to the manager, and stops listening once unobserved', async () => {
    const manager = new ControlledBrowserManager();
    const source = new SharedBrowserSource(manager, () => Promise.resolve(null), vi.fn());
    const observer = vi.fn();
    const { unsubscribe } = source.observe(observer);
    manager.launch('project-a');
    await source.close('project-a');
    expect(manager.close).toHaveBeenCalledWith('project-a');
    await source.setEnabled(false);
    expect(manager.setEnabled).toHaveBeenCalledWith(false);

    unsubscribe();
    observer.mockClear();
    manager.launch('project-a');
    expect(observer).not.toHaveBeenCalled();
  });

  it('reports a setting that cannot be read', async () => {
    const manager = new ControlledBrowserManager();
    vi.spyOn(manager, 'isEnabled').mockRejectedValue(new Error('corrupt settings'));
    const report = vi.fn();
    new SharedBrowserSource(manager, () => Promise.resolve(null), report).observe(vi.fn());
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith('presentation.shared_browser_setting_read_failed', {
        error: 'corrupt settings',
      }),
    );
  });

  it('reads each project name once, when its browser first appears', async () => {
    const manager = new ControlledBrowserManager();
    const readProjectName = vi.fn((projectId: string) =>
      projectId === 'project-a' ? Promise.resolve('Website') : Promise.reject(new Error('offline')),
    );
    const report = vi.fn();
    const observer = vi.fn();
    new SharedBrowserSource(manager, readProjectName, report).observe(observer);
    manager.launch('project-a');
    await manager.close('project-a');
    manager.launch('project-a');
    manager.launch('project-b');
    await vi.waitFor(() =>
      expect(observer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projects: [
            { projectId: 'project-a', name: 'Website', status: 'running' },
            { projectId: 'project-b', name: null, status: 'running' },
          ],
        }),
      ),
    );
    expect(readProjectName).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith('presentation.shared_browser_project_name_failed', {
        projectId: 'project-b',
        error: 'offline',
      }),
    );
  });
});
