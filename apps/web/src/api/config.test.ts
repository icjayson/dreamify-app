import { describe, expect, it } from 'vitest';

import { getApiBaseUrl } from './config';

describe('getApiBaseUrl', () => {
  it('uses the documented FastAPI origin during local development', () => {
    expect(getApiBaseUrl(undefined, 'development')).toBe('http://localhost:5000');
  });

  it('normalizes an explicitly configured API origin', () => {
    expect(getApiBaseUrl(' https://api.example.test/// ', 'development')).toBe(
      'https://api.example.test',
    );
  });

  it('does not infer an API origin outside development', () => {
    expect(getApiBaseUrl(undefined, 'production')).toBe('');
    expect(getApiBaseUrl(undefined, 'test')).toBe('');
  });
});
