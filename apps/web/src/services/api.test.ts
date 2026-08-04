import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiClient response handling', () => {
  it('accepts a successful 204 response without trying to parse JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api.delete<void>('/api/v1/projects/project_1')).resolves.toEqual({
      success: true,
      status: 204,
    });
  });

  it('preserves the typed platform error envelope and its user-facing message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'FEATURE_DISABLED',
              message: 'Scheduling is disabled in this deployment',
              details: { feature: 'scheduling' },
            },
          },
          { status: 503 },
        ),
      ),
    );

    const result = await api.get('/api/v1/schedules');

    expect(result).toEqual({
      success: false,
      error: 'Scheduling is disabled in this deployment',
      errorInfo: {
        code: 'FEATURE_DISABLED',
        message: 'Scheduling is disabled in this deployment',
        details: { feature: 'scheduling' },
        status: 503,
      },
      status: 503,
    });
  });

  it('keeps compatibility with legacy FastAPI detail errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ detail: 'Project was not found' }, { status: 404 }),
      ),
    );

    const result = await api.get('/api/v1/projects/missing');

    expect(result.error).toBe('Project was not found');
    expect(result.errorInfo).toEqual({
      message: 'Project was not found',
      status: 404,
    });
  });

  it('does not expose an HTML error document as the API error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html><body>Not Found</body></html>', {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    const result = await api.get('/api/v1/user/project/list');

    expect(result.error).toBe('API request returned HTML instead of JSON (status: 404)');
    expect(result.errorInfo).toEqual({
      code: 'INVALID_API_RESPONSE',
      message: 'API request returned HTML instead of JSON (status: 404)',
      status: 404,
    });
  });
});
