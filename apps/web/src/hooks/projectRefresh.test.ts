import { describe, expect, it, vi } from 'vitest';

import { settleProjectRefresh } from './projectRefresh';

describe('settleProjectRefresh', () => {
  it('turns a failed shared refresh into the last known project list', async () => {
    const cachedProjects = [{ id: 'project_1', title: 'Cached project' }];
    const reportError = vi.fn();

    await expect(
      settleProjectRefresh(
        Promise.reject(new Error('Failed to fetch')),
        () => cachedProjects,
        reportError,
      ),
    ).resolves.toBe(cachedProjects);

    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Failed to fetch' }));
  });

  it('returns a successful refresh without consulting the fallback', async () => {
    const projects = [{ id: 'project_2', title: 'Fresh project' }];
    const fallback = vi.fn(() => []);
    const reportError = vi.fn();

    await expect(
      settleProjectRefresh(Promise.resolve(projects), fallback, reportError),
    ).resolves.toBe(projects);

    expect(fallback).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
